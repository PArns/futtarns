import { eq } from 'drizzle-orm';
import { appUrl, generateToken } from '@/lib/auth-tokens';
import { daysBetween, todayIso, type IsoDate } from '@/lib/dates';
import type { Db } from '@/lib/db/client';
import { appSecrets } from '@/lib/db/schema';
import { payLinkToken, readPayLinkToken } from '@/lib/pay-links';
import {
  loadFriday,
  recordPayment,
  type FridayView,
  type Participant,
} from '@/lib/services/fridays';

const SECRET = 'pay-links';
// Reminders go out for ten days after a Friday; a link from the last one keeps working a while.
const LINK_DAYS = 30;

/**
 * A random secret made on first use and kept in the database, so it survives redeploys
 * without another environment variable to set.
 */
async function appSecret(db: Db, name: string): Promise<string> {
  await db.insert(appSecrets).values({ name, value: generateToken() }).onConflictDoNothing();
  const [row] = await db.select().from(appSecrets).where(eq(appSecrets.name, name));
  return row!.value;
}

/** Makes the „bezahlt“ links the payment reminders carry. */
export async function payLinkMaker(db: Db): Promise<(date: IsoDate, memberId: number) => string> {
  const secret = await appSecret(db, SECRET);
  return (date, memberId) => `${appUrl()}/bezahlt/${payLinkToken(secret, date, memberId)}`;
}

/** The Friday and the person a payment link is for, or null when it is forged or too old. */
export async function openPayLink(
  db: Db,
  token: string,
  now: Date
): Promise<{ view: FridayView; entry: Participant } | null> {
  const target = readPayLinkToken(await appSecret(db, SECRET), token);
  if (!target) return null;
  const age = daysBetween(target.date, todayIso(now));
  if (age < -7 || age > LINK_DAYS) return null;
  const view = await loadFriday(db, target.date, now);
  const entry = view.participants.find((participant) => participant.member.id === target.memberId);
  return entry ? { view, entry } : null;
}

/**
 * Books what is open on a payment link, as the server works it out, which also ends the
 * reminders. Returns the amount, 0 when nothing was open, null for a bad link.
 */
export async function payByLink(db: Db, token: string, now: Date): Promise<number | null> {
  const opened = await openPayLink(db, token, now);
  if (!opened) return null;
  const { view, entry } = opened;
  const open = entry.money.openCents;
  if (open <= 0) return 0;
  await recordPayment(db, {
    date: view.date,
    memberId: entry.member.id,
    amountCents: open,
    // A guest's reminder goes to whoever brought them, so that is who ticked it off.
    recordedById:
      entry.member.kind === 'guest' ? (entry.addedById ?? entry.member.id) : entry.member.id,
  });
  return open;
}
