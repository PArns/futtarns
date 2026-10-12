import { and, asc, eq, gt, gte, lte, sql } from 'drizzle-orm';
import { generateToken, hashToken, loginLink } from '@/lib/auth-tokens';
import type { Db } from '@/lib/db/client';
import { absences, attendance, members, sessions, type Member } from '@/lib/db/schema';
import type { IsoDate } from '@/lib/dates';

export class ServiceError extends Error {}

/** Personal links are a way in for a couple of weeks, not forever. */
export const LOGIN_LINK_DAYS = 14;

function linkExpiry(now = new Date()) {
  return new Date(now.getTime() + LOGIN_LINK_DAYS * 86_400_000);
}

export async function findMemberByLoginToken(
  db: Db,
  token: string,
  now = new Date()
): Promise<Member | null> {
  const [member] = await db
    .select()
    .from(members)
    .where(
      and(
        eq(members.loginTokenHash, hashToken(token)),
        gt(members.loginTokenExpiresAt, now),
        eq(members.active, true),
        eq(members.kind, 'member')
      )
    );
  return member ?? null;
}

/**
 * Signs in with a login link once: the link is used up, so a forwarded or leaked one no
 * longer works. Null if it is unknown, expired or already used.
 */
export async function consumeLoginToken(
  db: Db,
  token: string,
  now = new Date()
): Promise<Member | null> {
  const [member] = await db
    .update(members)
    .set({ loginTokenHash: null, loginTokenExpiresAt: null })
    .where(
      and(
        eq(members.loginTokenHash, hashToken(token)),
        gt(members.loginTokenExpiresAt, now),
        eq(members.active, true),
        eq(members.kind, 'member')
      )
    )
    .returning();
  return member ?? null;
}

export async function findMemberByCalendarToken(db: Db, token: string): Promise<Member | null> {
  const [member] = await db
    .select()
    .from(members)
    .where(and(eq(members.calendarToken, token), eq(members.active, true)));
  return member ?? null;
}

/** Who orders from `restaurantId` when they host, as `Patrick, Anna`; null when nobody does. */
export function hostsUsing(people: Member[], restaurantId: number): string | null {
  const names = people
    .filter((person) => person.active && person.defaultRestaurantId === restaurantId)
    .map((person) => person.name);
  return names.length ? names.join(', ') : null;
}

export async function listMembers(db: Db): Promise<Member[]> {
  return db.select().from(members).where(eq(members.kind, 'member')).orderBy(asc(members.name));
}

export async function getDefaultHost(db: Db): Promise<Member | null> {
  const [host] = await db
    .select()
    .from(members)
    .where(and(eq(members.isDefaultHost, true), eq(members.active, true)));
  return host ?? null;
}

export type NewMember = {
  name: string;
  phone?: string | null;
  paypalMe?: string | null;
  isAdmin?: boolean;
  isDefaultHost?: boolean;
};

/** Creates a member and returns the login token, which is shown once and never stored. */
export async function createMember(
  db: Db,
  input: NewMember,
  createdById: number | null
): Promise<{ member: Member; loginToken: string }> {
  const loginToken = generateToken();
  const member = await db.transaction(async (tx) => {
    if (input.isDefaultHost) {
      await tx.update(members).set({ isDefaultHost: false }).where(eq(members.isDefaultHost, true));
    }
    const [created] = await tx
      .insert(members)
      .values({
        name: input.name.trim(),
        phone: input.phone || null,
        paypalMe: input.paypalMe || null,
        isAdmin: input.isAdmin ?? false,
        isDefaultHost: input.isDefaultHost ?? false,
        loginTokenHash: hashToken(loginToken),
        loginTokenExpiresAt: linkExpiry(),
        calendarToken: generateToken(),
        createdById,
      })
      .returning();
    return created!;
  });
  return { member, loginToken };
}

/**
 * Issues a new login link; the old link stops working and every device the member was
 * signed in on is signed out. Called for a guest, it turns them into a member.
 */
export async function issueLoginToken(db: Db, memberId: number): Promise<string> {
  const loginToken = generateToken();
  const updated = await db.transaction(async (tx) => {
    await tx.delete(sessions).where(eq(sessions.memberId, memberId));
    return tx
      .update(members)
      .set({
        loginTokenHash: hashToken(loginToken),
        loginTokenExpiresAt: linkExpiry(),
        kind: 'member',
        calendarToken: sql`coalesce(${members.calendarToken}, ${generateToken()})`,
      })
      .where(eq(members.id, memberId))
      .returning({ id: members.id });
  });
  if (updated.length === 0) throw new ServiceError('Mitglied nicht gefunden');
  return loginToken;
}

/**
 * On an empty database, creates the first admin from `ADMIN_NAME` and `ADMIN_PHONE` and
 * prints their login link, so a fresh stack can be entered before the bot is paired.
 * Until an admin has logged in, every start prints a fresh link: one that scrolled out of
 * the log would otherwise leave nobody able to link WhatsApp.
 */
export async function bootstrapAdmin(
  db: Db,
  env: { name?: string; phone?: string | null },
  log: (line: string) => void,
  now = new Date()
) {
  const [someone] = await db.select({ id: members.id }).from(members).limit(1);
  if (!someone) {
    if (!env.name) return;
    const { member, loginToken } = await createMember(
      db,
      { name: env.name, phone: env.phone ?? null, isAdmin: true, isDefaultHost: true },
      null
    );
    log(`Created admin ${member.name}. Login link: ${loginLink(loginToken)}`);
    return;
  }
  const [loggedIn] = await db
    .select({ memberId: sessions.memberId })
    .from(sessions)
    .innerJoin(members, eq(members.id, sessions.memberId))
    .where(and(eq(members.isAdmin, true), eq(members.active, true), gt(sessions.expiresAt, now)))
    .limit(1);
  if (loggedIn) return;
  const [admin] = await db
    .select()
    .from(members)
    .where(and(eq(members.isAdmin, true), eq(members.active, true)))
    .orderBy(asc(members.id))
    .limit(1);
  if (!admin) return;
  log(
    `No admin is logged in yet. Login link for ${admin.name}: ${loginLink(await issueLoginToken(db, admin.id))}`
  );
}

export type ProfileUpdate = Partial<
  Pick<Member, 'name' | 'phone' | 'paypalMe' | 'address' | 'defaultRestaurantId'>
>;

export async function updateProfile(db: Db, memberId: number, update: ProfileUpdate) {
  await db.update(members).set(update).where(eq(members.id, memberId));
}

export async function setRoles(
  db: Db,
  memberId: number,
  roles: { isAdmin?: boolean; isDefaultHost?: boolean; active?: boolean }
) {
  await db.transaction(async (tx) => {
    if (roles.isDefaultHost) {
      await tx.update(members).set({ isDefaultHost: false }).where(eq(members.isDefaultHost, true));
    }
    await tx.update(members).set(roles).where(eq(members.id, memberId));
  });
}

/**
 * Adds a guest to a Friday. A guest with the same name is reused, so someone who comes
 * now and then keeps one entry.
 */
export async function addGuest(
  db: Db,
  friday: IsoDate,
  name: string,
  addedById: number
): Promise<Member> {
  const trimmed = name.trim();
  if (!trimmed) throw new ServiceError('Bitte einen Namen angeben');
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(members)
      .where(and(eq(members.kind, 'guest'), sql`lower(${members.name}) = lower(${trimmed})`));
    const guest =
      existing ??
      (
        await tx
          .insert(members)
          .values({ name: trimmed, kind: 'guest', createdById: addedById })
          .returning()
      )[0]!;
    await tx
      .insert(attendance)
      .values({ fridayDate: friday, memberId: guest.id, status: 'in', addedById })
      .onConflictDoUpdate({
        target: [attendance.fridayDate, attendance.memberId],
        // Whoever brought the guest first keeps them; others can't take over their order.
        set: {
          status: 'in',
          addedById: sql`coalesce(${attendance.addedById}, ${addedById})`,
          updatedAt: new Date(),
        },
      });
    return guest;
  });
}

export async function listAbsences(db: Db, memberId: number, from: IsoDate) {
  return db
    .select()
    .from(absences)
    .where(and(eq(absences.memberId, memberId), gte(absences.toDate, from)))
    .orderBy(asc(absences.fromDate));
}

export async function absencesOverlapping(db: Db, from: IsoDate, to: IsoDate) {
  return db
    .select()
    .from(absences)
    .where(and(lte(absences.fromDate, to), gte(absences.toDate, from)));
}

export async function addAbsence(
  db: Db,
  memberId: number,
  fromDate: IsoDate,
  toDate: IsoDate,
  note: string | null
) {
  if (toDate < fromDate) throw new ServiceError('Das Ende liegt vor dem Anfang');
  await db.insert(absences).values({ memberId, fromDate, toDate, note });
}

export async function removeAbsence(db: Db, memberId: number, absenceId: number) {
  await db.delete(absences).where(and(eq(absences.id, absenceId), eq(absences.memberId, memberId)));
}
