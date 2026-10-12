import { and, asc, eq, gte, inArray, isNull, lte, or } from 'drizzle-orm';
import { effectiveAttendance, type EffectiveAttendance } from '@/lib/attendance';
import {
  currentFriday,
  isPastDeadline,
  orderDeadline,
  orderTime,
  addWeeks,
  fridaysFrom,
  type IsoDate,
} from '@/lib/dates';
import type { Db } from '@/lib/db/client';
import {
  attendance,
  charges,
  dishes,
  fridays,
  memberDefaults,
  members,
  orderItems,
  restaurants,
  type AttendanceStatus,
  type Charge,
  type Dish,
  type Friday,
  type Member,
  type OrderItem,
  type Restaurant,
} from '@/lib/db/schema';
import { unitPriceCents } from '@/lib/menu/options';
import { estimateFees, splitTotal, type FeeEstimate, type MemberShare } from '@/lib/pricing';
import { absencesOverlapping, getDefaultHost, ServiceError } from '@/lib/services/members';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

async function ensureFridayRow(db: Db | Tx, date: IsoDate) {
  await db.insert(fridays).values({ date }).onConflictDoNothing();
}

export async function getFridayRow(db: Db, date: IsoDate): Promise<Friday | null> {
  const [row] = await db.select().from(fridays).where(eq(fridays.date, date));
  return row ?? null;
}

/** The host of a Friday: the one entered for it, otherwise the default host. */
export async function hostIdFor(db: Db, date: IsoDate): Promise<number | null> {
  const row = await getFridayRow(db, date);
  if (row?.hostId) return row.hostId;
  return (await getDefaultHost(db))?.id ?? null;
}

export async function setHost(db: Db, date: IsoDate, hostId: number | null) {
  await ensureFridayRow(db, date);
  await db.update(fridays).set({ hostId, updatedAt: new Date() }).where(eq(fridays.date, date));
}

export async function setCancelled(
  db: Db,
  date: IsoDate,
  cancelled: boolean,
  reason: string | null
) {
  await ensureFridayRow(db, date);
  await db
    .update(fridays)
    .set({ cancelled, cancelReason: cancelled ? reason : null, updatedAt: new Date() })
    .where(eq(fridays.date, date));
}

export async function setFridayNote(db: Db, date: IsoDate, note: string | null) {
  await ensureFridayRow(db, date);
  await db.update(fridays).set({ note, updatedAt: new Date() }).where(eq(fridays.date, date));
}

/** Picks the restaurant. Switching to another one drops the orders placed so far. */
export async function setRestaurant(db: Db, date: IsoDate, restaurantId: number | null) {
  await db.transaction(async (tx) => {
    await ensureFridayRow(tx, date);
    const [row] = await tx.select().from(fridays).where(eq(fridays.date, date));
    if (row!.lockedAt) throw new ServiceError('Die Bestellung ist schon geschlossen');
    if (row!.restaurantId === restaurantId) return;
    await tx.delete(orderItems).where(eq(orderItems.fridayDate, date));
    await tx
      .update(fridays)
      .set({ restaurantId, updatedAt: new Date() })
      .where(eq(fridays.date, date));
  });
}

/** Records an answer. Anything but a plain yes takes back what that person had ordered. */
export async function setAttendance(
  db: Db,
  date: IsoDate,
  memberId: number,
  status: AttendanceStatus
) {
  await db.transaction(async (tx) => {
    await tx
      .insert(attendance)
      .values({ fridayDate: date, memberId, status })
      .onConflictDoUpdate({
        target: [attendance.fridayDate, attendance.memberId],
        set: { status, updatedAt: new Date() },
      });
    if (status !== 'in') {
      await tx
        .delete(orderItems)
        .where(and(eq(orderItems.fridayDate, date), eq(orderItems.memberId, memberId)));
    }
  });
}

/**
 * Closes ordering for a Friday once its deadline has passed: everyone who counts as
 * coming but picked nothing gets their default dish for the chosen restaurant. Runs at
 * most once per Friday, whoever triggers it first (a page view or the timer).
 */
export async function lockFriday(db: Db, date: IsoDate, now: Date): Promise<boolean> {
  if (!isPastDeadline(date, now)) return false;
  return db.transaction(async (tx) => {
    await ensureFridayRow(tx, date);
    const [row] = await tx
      .update(fridays)
      .set({ lockedAt: now, updatedAt: now })
      .where(and(eq(fridays.date, date), isNull(fridays.lockedAt), eq(fridays.cancelled, false)))
      .returning();
    if (!row) return false;
    if (row.restaurantId) await applyDefaults(tx, date, row.restaurantId);
    return true;
  });
}

async function applyDefaults(tx: Tx, date: IsoDate, restaurantId: number) {
  const everyone = await tx
    .select()
    .from(members)
    .where(and(eq(members.kind, 'member'), eq(members.active, true)));
  const answers = await tx.select().from(attendance).where(eq(attendance.fridayDate, date));
  const absent = await absencesOverlapping(tx, date, date);
  const ordered = new Set(
    (
      await tx
        .select({ memberId: orderItems.memberId })
        .from(orderItems)
        .where(eq(orderItems.fridayDate, date))
    ).map((item) => item.memberId)
  );
  const defaults = await tx
    .select({ entry: memberDefaults, dish: dishes })
    .from(memberDefaults)
    .innerJoin(dishes, eq(dishes.id, memberDefaults.dishId))
    .where(and(eq(memberDefaults.restaurantId, restaurantId), eq(dishes.archived, false)));

  for (const member of everyone) {
    if (ordered.has(member.id)) continue;
    const answer = answers.find((entry) => entry.memberId === member.id)?.status;
    if (effectiveAttendance(member, date, answer, absent).status !== 'in') continue;
    const fallback = defaults.find((entry) => entry.entry.memberId === member.id);
    if (!fallback) continue;
    await tx.insert(orderItems).values({
      fridayDate: date,
      memberId: member.id,
      dishId: fallback.dish.id,
      name: fallback.dish.name,
      unitPriceCents: unitPriceCents(fallback.dish.priceCents, fallback.entry.options),
      options: fallback.entry.options,
      note: fallback.entry.note,
      quantity: 1,
      isDefault: true,
    });
  }
}

/**
 * Locks the recent Fridays whose deadline has passed while nobody had the page open. A
 * Friday nobody touched has no row and nothing to lock; opening it locks it anyway.
 */
export async function lockDueFridays(db: Db, now: Date): Promise<IsoDate[]> {
  const thisWeek = currentFriday(now);
  const due = await db
    .select({ date: fridays.date })
    .from(fridays)
    .where(
      and(
        gte(fridays.date, addWeeks(thisWeek, -1)),
        lte(fridays.date, thisWeek),
        isNull(fridays.lockedAt),
        eq(fridays.cancelled, false)
      )
    );
  const locked: IsoDate[] = [];
  for (const { date } of due) {
    if (await lockFriday(db, date, now)) locked.push(date);
  }
  return locked;
}

/**
 * Splits the amount Lieferando actually charged and stores what everyone owes. The host
 * paid Lieferando, so their own share is marked paid; payments already made are kept.
 */
export async function settleFriday(db: Db, date: IsoDate, totalCents: number, now: Date) {
  await db.transaction(async (tx) => {
    const [row] = await tx.select().from(fridays).where(eq(fridays.date, date));
    if (!row?.lockedAt) throw new ServiceError('Erst nach Bestellschluss abrechnen');
    const items = await tx.select().from(orderItems).where(eq(orderItems.fridayDate, date));
    const shares = splitTotal(items, totalCents);
    if (shares.length === 0) throw new ServiceError('Es wurde nichts bestellt');
    const hostId = row.hostId ?? (await getDefaultHost(tx))?.id ?? null;
    const existing = await tx.select().from(charges).where(eq(charges.fridayDate, date));

    await tx.delete(charges).where(eq(charges.fridayDate, date));
    await tx.insert(charges).values(
      shares.map((share) => ({
        fridayDate: date,
        memberId: share.memberId,
        amountCents: share.totalCents,
        paidAt:
          share.memberId === hostId
            ? now
            : (existing.find((charge) => charge.memberId === share.memberId)?.paidAt ?? null),
      }))
    );
    await tx
      .update(fridays)
      .set({ finalTotalCents: totalCents, settledAt: now, updatedAt: now })
      .where(eq(fridays.date, date));
  });
}

/** Undoes the split so orders can be corrected; payments made so far are remembered. */
export async function reopenSettlement(db: Db, date: IsoDate) {
  await db
    .update(fridays)
    .set({ settledAt: null, updatedAt: new Date() })
    .where(eq(fridays.date, date));
}

export async function setPaid(db: Db, date: IsoDate, memberId: number, paidAt: Date | null) {
  await db
    .update(charges)
    .set({ paidAt })
    .where(and(eq(charges.fridayDate, date), eq(charges.memberId, memberId)));
}

export type Participant = {
  member: Member;
  attendance: EffectiveAttendance;
  addedById: number | null;
  items: OrderItem[];
  itemsCents: number;
  hasDefault: boolean;
  charge: Charge | null;
};

export type FridayView = {
  date: IsoDate;
  host: Member | null;
  hostIsDefault: boolean;
  cancelled: boolean;
  cancelReason: string | null;
  note: string | null;
  restaurant: Restaurant | null;
  dishes: Dish[];
  deadline: Date;
  orderTime: Date;
  locked: boolean;
  settled: boolean;
  finalTotalCents: number | null;
  participants: Participant[];
  estimate: FeeEstimate | null;
  shares: MemberShare[];
};

/** Everything a Friday page shows, after closing ordering if the deadline has passed. */
export async function loadFriday(db: Db, date: IsoDate, now: Date): Promise<FridayView> {
  await lockFriday(db, date, now);
  const row = await getFridayRow(db, date);
  const defaultHost = await getDefaultHost(db);

  const answers = await db.select().from(attendance).where(eq(attendance.fridayDate, date));
  const answeredIds = answers.map((answer) => answer.memberId);
  const people = await db
    .select()
    .from(members)
    .where(
      or(
        and(eq(members.kind, 'member'), eq(members.active, true)),
        answeredIds.length ? inArray(members.id, answeredIds) : undefined
      )
    )
    .orderBy(asc(members.name));
  const hostId = row?.hostId ?? defaultHost?.id ?? null;
  const host =
    people.find((person) => person.id === hostId) ??
    (hostId
      ? ((await db.select().from(members).where(eq(members.id, hostId)))[0] ?? null)
      : null);

  const restaurantId = row?.restaurantId ?? null;
  const [restaurant] = restaurantId
    ? await db.select().from(restaurants).where(eq(restaurants.id, restaurantId))
    : [];
  const menu = restaurantId
    ? await db
        .select()
        .from(dishes)
        .where(and(eq(dishes.restaurantId, restaurantId), eq(dishes.archived, false)))
        .orderBy(asc(dishes.sortOrder), asc(dishes.id))
    : [];
  const defaultsFor = restaurantId
    ? new Set(
        (
          await db
            .select({ memberId: memberDefaults.memberId })
            .from(memberDefaults)
            .where(eq(memberDefaults.restaurantId, restaurantId))
        ).map((entry) => entry.memberId)
      )
    : new Set<number>();

  const items = await db
    .select()
    .from(orderItems)
    .where(eq(orderItems.fridayDate, date))
    .orderBy(asc(orderItems.id));
  const absent = await absencesOverlapping(db, date, date);
  const storedCharges = await db.select().from(charges).where(eq(charges.fridayDate, date));

  const participants = people.map((member): Participant => {
    const answer = answers.find((entry) => entry.memberId === member.id);
    const own = items.filter((item) => item.memberId === member.id);
    return {
      member,
      attendance: effectiveAttendance(member, date, answer?.status, absent),
      addedById: answer?.addedById ?? null,
      items: own,
      itemsCents: own.reduce((sum, item) => sum + item.unitPriceCents * item.quantity, 0),
      hasDefault: defaultsFor.has(member.id),
      charge: storedCharges.find((charge) => charge.memberId === member.id) ?? null,
    };
  });

  const subtotal = items.reduce((sum, item) => sum + item.unitPriceCents * item.quantity, 0);
  const estimate = restaurant ? estimateFees(subtotal, restaurant) : null;
  const finalTotalCents = row?.finalTotalCents ?? null;
  const shares = splitTotal(items, finalTotalCents ?? estimate?.totalCents ?? subtotal);

  return {
    date,
    host,
    hostIsDefault: !row?.hostId,
    cancelled: row?.cancelled ?? false,
    cancelReason: row?.cancelReason ?? null,
    note: row?.note ?? null,
    restaurant: restaurant ?? null,
    dishes: menu,
    deadline: orderDeadline(date),
    orderTime: orderTime(date),
    locked: Boolean(row?.lockedAt),
    settled: Boolean(row?.settledAt),
    finalTotalCents,
    participants,
    estimate,
    shares,
  };
}

export type CalendarEntry = {
  date: IsoDate;
  host: Member | null;
  hostIsDefault: boolean;
  cancelled: boolean;
  cancelReason: string | null;
  note: string | null;
  restaurant: Pick<Restaurant, 'id' | 'name' | 'cuisine'> | null;
  hostAbsent: boolean;
  absentMemberIds: number[];
};

/** The coming Fridays with host, restaurant and who is away, for the calendar. */
export async function loadCalendar(db: Db, from: IsoDate, weeks: number): Promise<CalendarEntry[]> {
  const dates = fridaysFrom(from, weeks);
  const to = dates[dates.length - 1]!;
  const rows = await db
    .select()
    .from(fridays)
    .where(and(gte(fridays.date, from), lte(fridays.date, to)));
  const everyone = await db.select().from(members);
  const defaultHost = everyone.find((member) => member.isDefaultHost && member.active) ?? null;
  const allRestaurants = await db
    .select({ id: restaurants.id, name: restaurants.name, cuisine: restaurants.cuisine })
    .from(restaurants);
  const absent = await absencesOverlapping(db, from, to);

  return dates.map((date) => {
    const row = rows.find((entry) => entry.date === date);
    const host = row?.hostId
      ? (everyone.find((member) => member.id === row.hostId) ?? null)
      : defaultHost;
    const absentMemberIds = absent
      .filter((absence) => absence.fromDate <= date && date <= absence.toDate)
      .map((absence) => absence.memberId);
    return {
      date,
      host,
      hostIsDefault: !row?.hostId,
      cancelled: row?.cancelled ?? false,
      cancelReason: row?.cancelReason ?? null,
      note: row?.note ?? null,
      restaurant: allRestaurants.find((entry) => entry.id === row?.restaurantId) ?? null,
      hostAbsent: host ? absentMemberIds.includes(host.id) : false,
      absentMemberIds: [...new Set(absentMemberIds)],
    };
  });
}

export type OpenCharge = {
  fridayDate: IsoDate;
  amountCents: number;
  payee: Pick<Member, 'id' | 'name' | 'paypalMe'> | null;
};

/** What a member still owes, oldest first, with whom to pay. */
export async function openChargesFor(db: Db, memberId: number): Promise<OpenCharge[]> {
  const open = await db
    .select({ charge: charges, friday: fridays })
    .from(charges)
    .innerJoin(fridays, eq(fridays.date, charges.fridayDate))
    .where(and(eq(charges.memberId, memberId), isNull(charges.paidAt)))
    .orderBy(asc(charges.fridayDate));
  if (open.length === 0) return [];
  const defaultHost = await getDefaultHost(db);
  const everyone = await db.select().from(members);
  return open.map(({ charge, friday }) => {
    const payeeId = friday.hostId ?? defaultHost?.id ?? null;
    const payee = everyone.find((member) => member.id === payeeId) ?? null;
    return {
      fridayDate: charge.fridayDate,
      amountCents: charge.amountCents,
      payee: payee ? { id: payee.id, name: payee.name, paypalMe: payee.paypalMe } : null,
    };
  });
}
