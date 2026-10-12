import { createHmac, timingSafeEqual } from 'node:crypto';
import { isFridayIso, type IsoDate } from '@/lib/dates';

const TOKEN = /^(\d{4}-\d{2}-\d{2})\.(\d{1,9})\.([\w-]{22})$/;

function signature(secret: string, date: IsoDate, memberId: number): string {
  return createHmac('sha256', secret)
    .update(`paid:${date}:${memberId}`)
    .digest('base64url')
    .slice(0, 22);
}

/**
 * The token in a payment reminder's „bezahlt“ link: which Friday, whose balance, and a
 * signature, so nobody can make a link for someone else's money.
 */
export function payLinkToken(secret: string, date: IsoDate, memberId: number): string {
  return `${date}.${memberId}.${signature(secret, date, memberId)}`;
}

/** Reads a payment link token back, or null when it was not signed with this secret. */
export function readPayLinkToken(
  secret: string,
  token: string
): { date: IsoDate; memberId: number } | null {
  const match = TOKEN.exec(token);
  if (!match || !isFridayIso(match[1]!)) return null;
  const date = match[1]!;
  const memberId = Number(match[2]);
  const expected = Buffer.from(signature(secret, date, memberId));
  const given = Buffer.from(match[3]!);
  return timingSafeEqual(expected, given) ? { date, memberId } : null;
}
