import { and, asc, count, desc, eq, gte, ilike, inArray, lt, max } from 'drizzle-orm';
import {
  CHAT_DAYS,
  CONTEXT_HOURS,
  CONTEXT_MESSAGES,
  redactSecrets,
  type ChatLine,
} from '@/lib/chat';
import type { Db } from '@/lib/db/client';
import {
  chatMessages,
  members,
  type ChatDirection,
  type ChatKind,
  type ChatMessage,
} from '@/lib/db/schema';

/**
 * The bot's chats with the members (`chat_messages`): what each member wrote, what the bot
 * answered and what it sent them on its own. Storing never gets in the way of the bot: a
 * message that cannot be stored is only logged.
 */

export type ChatEntry = {
  memberId: number;
  direction: ChatDirection;
  kind: ChatKind;
  detail?: string | null;
  text: string;
};

/** Stores one message of a member's chat, without its secrets; its id, or null on failure. */
export async function recordChat(db: Db, entry: ChatEntry, now: Date): Promise<number | null> {
  try {
    const [row] = await db
      .insert(chatMessages)
      .values({
        memberId: entry.memberId,
        direction: entry.direction,
        kind: entry.kind,
        detail: entry.detail ?? null,
        text: redactSecrets(entry.text),
        createdAt: now,
      })
      .returning({ id: chatMessages.id });
    return row?.id ?? null;
  } catch (error) {
    console.error('[chats] could not store a message', error);
    return null;
  }
}

/**
 * Stores what the bot sent to a number, when the number is a member's (not the group's).
 * `detail` is the message's key, so it is clear which reminder it was.
 */
export async function recordSent(
  db: Db,
  to: string,
  text: string,
  detail: string | null,
  now: Date,
  kind: ChatKind = 'message'
): Promise<void> {
  try {
    const [member] = await db.select({ id: members.id }).from(members).where(eq(members.phone, to));
    if (!member) return;
    await recordChat(db, { memberId: member.id, direction: 'out', kind, detail, text }, now);
  } catch (error) {
    console.error('[chats] could not store a sent message', error);
  }
}

/** Notes what came of a member's message, such as the action Claude read in it. */
export async function noteChatDetail(db: Db, id: number | null, detail: string): Promise<void> {
  if (id === null) return;
  try {
    await db.update(chatMessages).set({ detail }).where(eq(chatMessages.id, id));
  } catch (error) {
    console.error('[chats] could not note what came of a message', error);
  }
}

/**
 * What Claude reads along with a new message: the member's chat of the last hours, oldest
 * first, without the new message itself (`beforeId`).
 */
export async function recentChat(
  db: Db,
  memberId: number,
  now: Date,
  beforeId: number | null
): Promise<ChatLine[]> {
  const rows = await db
    .select({
      direction: chatMessages.direction,
      text: chatMessages.text,
      createdAt: chatMessages.createdAt,
    })
    .from(chatMessages)
    .where(
      and(
        eq(chatMessages.memberId, memberId),
        gte(chatMessages.createdAt, new Date(now.getTime() - CONTEXT_HOURS * 3_600_000)),
        beforeId === null ? undefined : lt(chatMessages.id, beforeId)
      )
    )
    .orderBy(desc(chatMessages.createdAt), desc(chatMessages.id))
    .limit(CONTEXT_MESSAGES);
  return rows.reverse();
}

/** Forgets chats older than `CHAT_DAYS`; says how many messages went. */
export async function pruneChats(db: Db, now: Date): Promise<number> {
  const deleted = await db
    .delete(chatMessages)
    .where(lt(chatMessages.createdAt, new Date(now.getTime() - CHAT_DAYS * 86_400_000)))
    .returning({ id: chatMessages.id });
  return deleted.length;
}

export type ChatSummary = {
  member: { id: number; name: string };
  messages: number;
  lastAt: Date;
  last: Pick<ChatMessage, 'direction' | 'kind' | 'text'>;
};

/**
 * Whose chats there are, the latest first: how many messages and the last one. `memberIds`
 * limits it to some members, `q` to chats with a message containing it.
 */
export async function chatSummaries(
  db: Db,
  filter: { memberIds?: number[]; q?: string; since?: Date; limit?: number }
): Promise<ChatSummary[]> {
  const where = and(
    filter.memberIds ? inArray(chatMessages.memberId, filter.memberIds) : undefined,
    filter.since ? gte(chatMessages.createdAt, filter.since) : undefined
  );
  const matching = filter.q
    ? db
        .selectDistinct({ memberId: chatMessages.memberId })
        .from(chatMessages)
        .where(and(where, ilike(chatMessages.text, `%${escapeLike(filter.q)}%`)))
    : null;
  const totals = await db
    .select({
      memberId: chatMessages.memberId,
      name: members.name,
      messages: count(),
      lastAt: max(chatMessages.createdAt),
      lastId: max(chatMessages.id),
    })
    .from(chatMessages)
    .innerJoin(members, eq(members.id, chatMessages.memberId))
    .where(and(where, matching ? inArray(chatMessages.memberId, matching) : undefined))
    .groupBy(chatMessages.memberId, members.name)
    .orderBy(desc(max(chatMessages.createdAt)), desc(max(chatMessages.id)))
    .limit(filter.limit ?? 50);
  if (!totals.length) return [];
  const lasts = await db
    .select()
    .from(chatMessages)
    .where(
      inArray(
        chatMessages.id,
        totals.map((row) => row.lastId!)
      )
    );
  return totals.map((row) => {
    const last = lasts.find((message) => message.id === row.lastId)!;
    return {
      member: { id: row.memberId, name: row.name },
      messages: row.messages,
      lastAt: row.lastAt!,
      last: { direction: last.direction, kind: last.kind, text: last.text },
    };
  });
}

/**
 * One member's chat in order, oldest first: the last `limit` messages, or with `beforeId`
 * the ones before it, to page further back.
 */
export async function chatOf(
  db: Db,
  memberId: number,
  options: { limit?: number; beforeId?: number; since?: Date } = {}
): Promise<{ messages: ChatMessage[]; more: boolean }> {
  const limit = options.limit ?? 50;
  const rows = await db
    .select()
    .from(chatMessages)
    .where(
      and(
        eq(chatMessages.memberId, memberId),
        options.beforeId === undefined ? undefined : lt(chatMessages.id, options.beforeId),
        options.since ? gte(chatMessages.createdAt, options.since) : undefined
      )
    )
    .orderBy(desc(chatMessages.createdAt), desc(chatMessages.id))
    .limit(limit + 1);
  return { messages: rows.slice(0, limit).reverse(), more: rows.length > limit };
}

/** Oldest stored message, so readers know how far back the chats go. */
export async function oldestChatAt(db: Db): Promise<Date | null> {
  const [row] = await db
    .select({ at: chatMessages.createdAt })
    .from(chatMessages)
    .orderBy(asc(chatMessages.createdAt))
    .limit(1);
  return row?.at ?? null;
}

/** Makes `%`, `_` and `\` in a search match themselves. */
function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (char) => `\\${char}`);
}
