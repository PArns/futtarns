import { eq } from 'drizzle-orm';
import { appUrl } from '@/lib/auth-tokens';
import { addWeeks, currentFriday, type IsoDate } from '@/lib/dates';
import type { Db } from '@/lib/db/client';
import { dishes, memberDefaults, notifications } from '@/lib/db/schema';
import { planReminders, type Outgoing } from '@/lib/reminders';
import { getFridayRow, loadFriday, lockDueFridays } from '@/lib/services/fridays';
import { sendWhatsApp, type SendResult } from '@/lib/whatsapp';

async function defaultDishNames(db: Db, restaurantId: number | null): Promise<Map<number, string>> {
  if (!restaurantId) return new Map();
  const rows = await db
    .select({ memberId: memberDefaults.memberId, name: dishes.name })
    .from(memberDefaults)
    .innerJoin(dishes, eq(dishes.id, memberDefaults.dishId))
    .where(eq(memberDefaults.restaurantId, restaurantId));
  return new Map(rows.map((row) => [row.memberId, row.name]));
}

/** Sends a message unless its key went out before; a failed send is retried next run. */
async function deliver(
  db: Db,
  message: Outgoing,
  send: (to: string, text: string) => Promise<SendResult>
) {
  const claimed = await db
    .insert(notifications)
    .values({ key: message.key })
    .onConflictDoNothing()
    .returning();
  if (claimed.length === 0) return false;
  if ((await send(message.to, message.text)) === 'failed') {
    await db.delete(notifications).where(eq(notifications.key, message.key));
    return false;
  }
  return true;
}

/**
 * One scheduler pass: close Fridays whose deadline passed, then send whatever reminders
 * are due for this week's Friday and the two before it (for payment reminders).
 */
export async function runScheduler(
  db: Db,
  now: Date,
  send: (to: string, text: string) => Promise<SendResult> = sendWhatsApp
): Promise<number> {
  await lockDueFridays(db, now);
  const thisWeek = currentFriday(now);
  const dates: IsoDate[] = [addWeeks(thisWeek, -2), addWeeks(thisWeek, -1), thisWeek];
  let sent = 0;
  for (const date of dates) {
    // Past Fridays nobody touched have nothing to remind anyone of.
    if (date !== thisWeek && !(await getFridayRow(db, date))) continue;
    const view = await loadFriday(db, date, now);
    const messages = planReminders({
      view,
      now,
      appUrl: appUrl(),
      defaultDish: await defaultDishNames(db, view.restaurant?.id ?? null),
      group: process.env.WHATSAPP_GROUP || null,
    });
    for (const message of messages) {
      if (await deliver(db, message, send)) sent++;
    }
  }
  return sent;
}
