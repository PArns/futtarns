import { eq, inArray, like, or } from 'drizzle-orm';
import { appUrl } from '@/lib/auth-tokens';
import { addWeeks, currentFriday, type IsoDate } from '@/lib/dates';
import type { Db } from '@/lib/db/client';
import { getAssistantKey } from '@/lib/services/assistant';
import { pruneChats, recordSent } from '@/lib/services/chats';
import { pruneReadings } from '@/lib/services/readings';
import { dishes, memberDefaults, notifications, type Member } from '@/lib/db/schema';
import { formatDayShort } from '@/lib/format';
import { bold } from '@/lib/messages';
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
 * Sends a message unless its key went out before, and with it the keys of the messages it
 * stands in for (`also`). A refused send is retried next run; one that timed out is not,
 * because it may have arrived. What went out to a member goes into their chat.
 */
export async function deliver(db: Db, message: Outgoing, send: Send, now: Date = new Date()) {
  const claimed = await db
    .insert(notifications)
    .values({ key: message.key })
    .onConflictDoNothing()
    .returning();
  if (claimed.length === 0) return false;
  const also = message.also?.length
    ? await db
        .insert(notifications)
        .values(message.also.map((key) => ({ key })))
        .onConflictDoNothing()
        .returning()
    : [];
  if ((await send(message.to, message.text)) === 'failed') {
    const keys = [message.key, ...also.map((row) => row.key)];
    await db.delete(notifications).where(inArray(notifications.key, keys));
    return false;
  }
  // It went out: it belongs to that member's chat now.
  await recordSent(db, message.to, message.text, message.key, now);
  return true;
}

/**
 * Whether the bot asked „Wo sind wir Freitag?“ for this Friday; then whoever takes it over
 * is announced to the others (`planReminders`).
 */
export async function askedWhere(db: Db, date: IsoDate): Promise<boolean> {
  const [row] = await db
    .select({ key: notifications.key })
    .from(notifications)
    .where(like(notifications.key, `nohost:${date}:%`))
    .limit(1);
  return Boolean(row);
}

/**
 * Tells the usual host that someone took their Friday over while they are around, so they
 * neither shop nor order for it. Says whether it went out.
 */
export async function tellTakenOver(
  db: Db,
  date: IsoDate,
  from: Member | null,
  taker: Pick<Member, 'id' | 'name'>,
  send: Send,
  now: Date
): Promise<boolean> {
  if (!from?.phone || from.id === taker.id) return false;
  return deliver(
    db,
    {
      key: `takenover:${date}:${from.id}:${now.getTime()}`,
      to: from.phone,
      text: `🙌 ${bold(`${taker.name} übernimmt Freitag (${formatDayShort(date)})!`)} Diesmal bist du nicht Gastgeber: ${taker.name} bestellt, und das Geld geht an ${taker.name}. Passt das nicht, sprecht euch kurz ab.\n${appUrl()}/freitag/${date}`,
    },
    send,
    now
  );
}

// A burst of identical-looking messages is what gets a linked device blocked.
export const pauseBetweenMessages = () =>
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
  await Promise.all([pruneChats(db, now), pruneReadings(db, now)]).catch((error: unknown) => {
    console.error('[scheduler] could not forget old chats', error);
  });
  const thisWeek = currentFriday(now);
  const dates: IsoDate[] = [addWeeks(thisWeek, -2), addWeeks(thisWeek, -1), thisWeek];
  const paidLink = await payLinkMaker(db);
  const assistant = Boolean(await getAssistantKey(db));
  let sent = 0;
  for (const date of dates) {
    // One Friday that breaks must not keep the others' reminders back; it is tried again
    // on the next pass.
    try {
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
        assistant,
      });
      for (const message of messages) {
        if (await deliver(db, message, send, now)) {
          sent++;
          await pause();
        }
      }
    } catch (error) {
      console.error(`[scheduler] reminders for ${date} failed`, error);
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
