import { eq, like, or } from 'drizzle-orm';
import { appUrl } from '@/lib/auth-tokens';
import { addWeeks, currentFriday, type IsoDate } from '@/lib/dates';
import type { Db } from '@/lib/db/client';
import { dishes, memberDefaults, notifications } from '@/lib/db/schema';
import {
  planReminders,
  previewReminders,
  summarizePlanned,
  type MessagePreview,
  type Outgoing,
} from '@/lib/reminders';
import {
  getFridayRow,
  loadFriday,
  lockDueFridays,
  projectVoteResult,
  type FridayView,
} from '@/lib/services/fridays';
import { itemLabel, lastOrdersAt } from '@/lib/services/orders';
import { payLinkMaker } from '@/lib/services/pay-links';
import { getRestaurant, restaurantsForHost } from '@/lib/services/restaurants';
import { voteWinner, votingAt } from '@/lib/vote';
import { sendWhatsApp, type SendResult } from '@/lib/whatsapp';

type Send = (to: string, text: string) => Promise<SendResult>;

async function defaultDishNames(db: Db, restaurantId: number | null): Promise<Map<number, string>> {
  if (!restaurantId) return new Map();
  const rows = await db
    .select({ memberId: memberDefaults.memberId, name: dishes.name })
    .from(memberDefaults)
    .innerJoin(dishes, eq(dishes.id, memberDefaults.dishId))
    .where(eq(memberDefaults.restaurantId, restaurantId));
  return new Map(rows.map((row) => [row.memberId, row.name]));
}

/** What everyone had the last time at a Friday's restaurant, for the last call. */
async function lastOrderTexts(
  db: Db,
  view: FridayView
): Promise<Map<number, { date: IsoDate; items: string }>> {
  if (!view.restaurant) return new Map();
  const last = await lastOrdersAt(db, view.restaurant.id, view.date);
  return new Map(
    [...last].map(([memberId, order]) => [
      memberId,
      { date: order.date, items: order.items.map(itemLabel).join(', ') },
    ])
  );
}

/**
 * The keys already sent for a Friday. Most keys carry the date in the middle
 * (`due:2026-10-16:7`), the order list's at the end (`sheet:2026-10-16`).
 */
async function sentKeysFor(db: Db, date: IsoDate): Promise<Set<string>> {
  const rows = await db
    .select({ key: notifications.key })
    .from(notifications)
    .where(or(like(notifications.key, `%:${date}:%`), like(notifications.key, `%:${date}`)));
  return new Set(rows.map((row) => row.key));
}

/**
 * Sends a message unless its key went out before. A refused send is retried next run; one
 * that timed out is not, because it may have arrived.
 */
async function deliver(db: Db, message: Outgoing, send: Send) {
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

// A burst of identical-looking messages is what gets a linked device blocked.
const pauseBetweenMessages = () =>
  new Promise((resolve) => setTimeout(resolve, 1500 + Math.random() * 3000));

/**
 * One scheduler pass: close Fridays whose deadline passed, then send whatever reminders
 * are due for this week's Friday and the two before it (for payment reminders).
 */
export async function runScheduler(
  db: Db,
  now: Date,
  send: Send = sendWhatsApp,
  pause: () => Promise<unknown> = pauseBetweenMessages
): Promise<number> {
  await lockDueFridays(db, now);
  const thisWeek = currentFriday(now);
  const dates: IsoDate[] = [addWeeks(thisWeek, -2), addWeeks(thisWeek, -1), thisWeek];
  const paidLink = await payLinkMaker(db);
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
      sent: await sentKeysFor(db, date),
      paidLink: (memberId) => paidLink(date, memberId),
      restaurants: await restaurantsForHost(db, view.host?.id ?? null),
      lastOrder: date === thisWeek ? await lastOrderTexts(db, view) : undefined,
    });
    for (const message of messages) {
      if (await deliver(db, message, send)) {
        sent++;
        await pause();
      }
    }
  }
  return sent;
}

/** The messages a Friday will still send, one line per time and kind, for the host. */
export async function upcomingMessages(
  db: Db,
  view: FridayView,
  now: Date
): Promise<MessagePreview[]> {
  const group = process.env.WHATSAPP_GROUP || null;
  const restaurants = await restaurantsForHost(db, view.host?.id ?? null);
  // While the vote runs, what comes after it assumes the restaurant ahead now wins.
  let afterVote: { view: FridayView; defaultDish: Map<number, string> } | undefined;
  if (votingAt(view, now) && restaurants.length > 1) {
    const votes = view.votes.filter((vote) =>
      restaurants.some((option) => option.id === vote.restaurantId)
    );
    const winnerId = voteWinner(votes, view.restaurant?.id ?? null);
    const winner =
      winnerId === null
        ? null
        : winnerId === view.restaurant?.id
          ? view.restaurant
          : await getRestaurant(db, winnerId);
    afterVote = {
      view: projectVoteResult(view, winner),
      defaultDish: await defaultDishNames(db, winnerId),
    };
  }
  const planned = previewReminders(
    {
      view,
      appUrl: appUrl(),
      defaultDish: await defaultDishNames(db, view.restaurant?.id ?? null),
      group,
      sent: await sentKeysFor(db, view.date),
      // Only who and when are shown, never the text.
      paidLink: () => '',
      restaurants,
    },
    now,
    afterVote
  );
  return summarizePlanned(planned, view, group);
}
