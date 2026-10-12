import { randomInt } from 'node:crypto';
import { and, desc, eq, gt, isNull, lt } from 'drizzle-orm';
import { generateToken, hashToken } from '@/lib/auth-tokens';
import type { Db } from '@/lib/db/client';
import { loginCodes, members, sessions, type Member } from '@/lib/db/schema';
import { ServiceError } from '@/lib/services/members';

export const SESSION_DAYS = 180;
const CODE_MINUTES = 10;
const CODE_RESEND_SECONDS = 45;
const CODE_ATTEMPTS = 5;
const CODES_PER_HOUR = 5;

export async function createSession(db: Db, memberId: number, now = new Date()): Promise<string> {
  const token = generateToken();
  await db.insert(sessions).values({
    tokenHash: hashToken(token),
    memberId,
    expiresAt: new Date(now.getTime() + SESSION_DAYS * 86_400_000),
  });
  return token;
}

export async function findMemberBySession(
  db: Db,
  token: string,
  now = new Date()
): Promise<Member | null> {
  const [row] = await db
    .select({ member: members })
    .from(sessions)
    .innerJoin(members, eq(members.id, sessions.memberId))
    .where(
      and(
        eq(sessions.tokenHash, hashToken(token)),
        gt(sessions.expiresAt, now),
        eq(members.active, true),
        eq(members.kind, 'member')
      )
    );
  return row?.member ?? null;
}

export async function deleteSession(db: Db, token: string) {
  await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
}

function hashCode(memberId: number, code: string) {
  return hashToken(`${memberId}:${code}`);
}

async function activeMemberByPhone(db: Db, phone: string): Promise<Member | null> {
  const [member] = await db
    .select()
    .from(members)
    .where(and(eq(members.phone, phone), eq(members.active, true), eq(members.kind, 'member')));
  return member ?? null;
}

/**
 * Issues a six-digit code for the member with this phone number. The caller sends it via
 * WhatsApp, which also proves the number is theirs.
 */
export async function requestLoginCode(
  db: Db,
  phone: string,
  now = new Date()
): Promise<{ member: Member; code: string }> {
  const member = await activeMemberByPhone(db, phone);
  if (!member)
    throw new ServiceError(
      'Diese Nummer kennen wir nicht. Frag den Gastgeber, ob er dich eingetragen hat.'
    );
  const [latest] = await db
    .select()
    .from(loginCodes)
    .where(eq(loginCodes.memberId, member.id))
    .orderBy(desc(loginCodes.createdAt))
    .limit(1);
  if (latest && now.getTime() - latest.createdAt.getTime() < CODE_RESEND_SECONDS * 1000) {
    throw new ServiceError(
      'Gerade eben kam schon ein Code. Warte kurz, bevor du einen neuen anforderst.'
    );
  }
  const lastHour = await db
    .select({ id: loginCodes.id })
    .from(loginCodes)
    .where(
      and(
        eq(loginCodes.memberId, member.id),
        gt(loginCodes.createdAt, new Date(now.getTime() - 3_600_000))
      )
    );
  if (lastHour.length >= CODES_PER_HOUR) {
    throw new ServiceError('Zu viele Codes in der letzten Stunde. Versuch es später nochmal.');
  }
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  // Expired codes stay an hour so the hourly limit can count them.
  await db
    .delete(loginCodes)
    .where(
      and(
        eq(loginCodes.memberId, member.id),
        lt(loginCodes.createdAt, new Date(now.getTime() - 3_600_000))
      )
    );
  await db.insert(loginCodes).values({
    memberId: member.id,
    codeHash: hashCode(member.id, code),
    expiresAt: new Date(now.getTime() + CODE_MINUTES * 60_000),
    createdAt: now,
  });
  return { member, code };
}

/** Checks a code; each code works once and survives only a handful of wrong guesses. */
export async function verifyLoginCode(
  db: Db,
  phone: string,
  code: string,
  now = new Date()
): Promise<Member> {
  const member = await activeMemberByPhone(db, phone);
  if (!member) throw new ServiceError('Diese Nummer kennen wir nicht.');
  const [latest] = await db
    .select()
    .from(loginCodes)
    .where(
      and(
        eq(loginCodes.memberId, member.id),
        isNull(loginCodes.usedAt),
        gt(loginCodes.expiresAt, now)
      )
    )
    .orderBy(desc(loginCodes.createdAt))
    .limit(1);
  if (!latest || latest.attempts >= CODE_ATTEMPTS) {
    throw new ServiceError('Der Code ist abgelaufen. Fordere einfach einen neuen an.');
  }
  if (latest.codeHash !== hashCode(member.id, code.replace(/\s/g, ''))) {
    await db
      .update(loginCodes)
      .set({ attempts: latest.attempts + 1 })
      .where(eq(loginCodes.id, latest.id));
    throw new ServiceError('Der Code stimmt nicht.');
  }
  await db.update(loginCodes).set({ usedAt: now }).where(eq(loginCodes.id, latest.id));
  return member;
}
