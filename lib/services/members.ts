import { and, asc, eq, gte, lte, sql } from 'drizzle-orm';
import { generateToken, hashToken } from '@/lib/auth-tokens';
import type { Db } from '@/lib/db/client';
import { absences, attendance, members, type Member } from '@/lib/db/schema';
import type { IsoDate } from '@/lib/dates';

export class ServiceError extends Error {}

export async function findMemberByLoginToken(db: Db, token: string): Promise<Member | null> {
  const [member] = await db
    .select()
    .from(members)
    .where(
      and(
        eq(members.loginTokenHash, hashToken(token)),
        eq(members.active, true),
        eq(members.kind, 'member')
      )
    );
  return member ?? null;
}

export async function findMemberByCalendarToken(db: Db, token: string): Promise<Member | null> {
  const [member] = await db
    .select()
    .from(members)
    .where(and(eq(members.calendarToken, token), eq(members.active, true)));
  return member ?? null;
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
        calendarToken: generateToken(),
        createdById,
      })
      .returning();
    return created!;
  });
  return { member, loginToken };
}

/**
 * Issues a new login link and makes the old one stop working. Called for a guest, it
 * turns them into a member.
 */
export async function issueLoginToken(db: Db, memberId: number): Promise<string> {
  const loginToken = generateToken();
  const updated = await db
    .update(members)
    .set({
      loginTokenHash: hashToken(loginToken),
      kind: 'member',
      calendarToken: sql`coalesce(${members.calendarToken}, ${generateToken()})`,
    })
    .where(eq(members.id, memberId))
    .returning({ id: members.id });
  if (updated.length === 0) throw new ServiceError('Mitglied nicht gefunden');
  return loginToken;
}

export type ProfileUpdate = Partial<Pick<Member, 'name' | 'phone' | 'paypalMe' | 'address'>>;

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
        set: { status: 'in', addedById, updatedAt: new Date() },
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
