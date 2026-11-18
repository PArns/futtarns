import { and, desc, eq, gte, ilike, isNotNull, isNull, lt, or, type SQL } from 'drizzle-orm';
import { PROMPT_VERSION, type Interpretation, type ReadingTrace } from '@/lib/assistant';
import { CHAT_DAYS } from '@/lib/chat';
import type { Db } from '@/lib/db/client';
import { assistantReadings, members, type AssistantReading } from '@/lib/db/schema';
import { ServiceError } from '@/lib/services/members';

/**
 * Claude's readings of the members' messages (`assistant_readings`), kept to judge and
 * improve the prompt: what it was given, what it made of it, and what that cost.
 */

export type NewReading = {
  memberId: number;
  chatMessageId: number | null;
  message: string;
  facts: string;
  chat: string;
  trace: ReadingTrace;
  interpretation: Interpretation | null;
  command: string | null;
  answer: string | null;
  durationMs: number;
  error: string | null;
};

/** Stores one reading; never gets in the way of the answer, so a failure is only logged. */
export async function recordReading(db: Db, reading: NewReading, now: Date): Promise<void> {
  try {
    await db.insert(assistantReadings).values({
      memberId: reading.memberId,
      chatMessageId: reading.chatMessageId,
      message: reading.message,
      facts: reading.facts,
      chat: reading.chat,
      model: reading.trace.model,
      promptVersion: PROMPT_VERSION,
      interpretation: reading.interpretation,
      action: reading.interpretation?.action ?? null,
      command: reading.command,
      answer: reading.answer,
      toolCalls: reading.trace.toolCalls,
      rounds: reading.trace.rounds,
      inputTokens: reading.trace.usage.input,
      outputTokens: reading.trace.usage.output,
      cacheReadTokens: reading.trace.usage.cacheRead,
      cacheWriteTokens: reading.trace.usage.cacheWrite,
      durationMs: Math.max(0, Math.round(reading.durationMs)),
      error: reading.error,
      createdAt: now,
    });
  } catch (error) {
    console.error('[readings] could not store a reading', error);
  }
}

/** Forgets readings as old as the chats they came from (`CHAT_DAYS`). */
export async function pruneReadings(db: Db, now: Date): Promise<number> {
  const deleted = await db
    .delete(assistantReadings)
    .where(lt(assistantReadings.createdAt, new Date(now.getTime() - CHAT_DAYS * 86_400_000)))
    .returning({ id: assistantReadings.id });
  return deleted.length;
}

export type ReadingFilter = {
  since?: Date;
  memberId?: number;
  action?: string;
  promptVersion?: string;
  /** Only readings that gave no usable answer. */
  failed?: boolean;
  /** 1 or -1 for that rating, 0 for readings nobody rated yet. */
  rating?: -1 | 0 | 1;
  /** A word in the message, Claude's reply or the answer. */
  q?: string;
  limit?: number;
};

export type ReadingRow = AssistantReading & { memberName: string };

/** Readings, the newest first, as the filter narrows them. */
export async function listReadings(db: Db, filter: ReadingFilter = {}): Promise<ReadingRow[]> {
  const conditions: (SQL | undefined)[] = [
    filter.since ? gte(assistantReadings.createdAt, filter.since) : undefined,
    filter.memberId ? eq(assistantReadings.memberId, filter.memberId) : undefined,
    filter.action ? eq(assistantReadings.action, filter.action) : undefined,
    filter.promptVersion ? eq(assistantReadings.promptVersion, filter.promptVersion) : undefined,
    filter.failed ? isNotNull(assistantReadings.error) : undefined,
    filter.rating === 0
      ? isNull(assistantReadings.rating)
      : filter.rating
        ? eq(assistantReadings.rating, filter.rating)
        : undefined,
    filter.q
      ? or(
          ilike(assistantReadings.message, `%${escapeLike(filter.q)}%`),
          ilike(assistantReadings.answer, `%${escapeLike(filter.q)}%`)
        )
      : undefined,
  ];
  const rows = await db
    .select({ reading: assistantReadings, memberName: members.name })
    .from(assistantReadings)
    .innerJoin(members, eq(members.id, assistantReadings.memberId))
    .where(and(...conditions))
    .orderBy(desc(assistantReadings.createdAt), desc(assistantReadings.id))
    .limit(filter.limit ?? 30);
  return rows.map((row) => ({ ...row.reading, memberName: row.memberName }));
}

/** One reading with whose message it was. */
export async function getReading(db: Db, id: number): Promise<ReadingRow | null> {
  const [row] = await db
    .select({ reading: assistantReadings, memberName: members.name })
    .from(assistantReadings)
    .innerJoin(members, eq(members.id, assistantReadings.memberId))
    .where(eq(assistantReadings.id, id));
  return row ? { ...row.reading, memberName: row.memberName } : null;
}

/** An admin's verdict on a reading: 1 good, -1 bad, 0 takes it back; the note says why. */
export async function rateReading(
  db: Db,
  id: number,
  rating: -1 | 0 | 1,
  note: string | null,
  ratedById: number
): Promise<void> {
  const updated = await db
    .update(assistantReadings)
    .set(
      rating === 0
        ? { rating: null, ratingNote: null, ratedById: null }
        : { rating, ratingNote: note, ratedById }
    )
    .where(eq(assistantReadings.id, id))
    .returning({ id: assistantReadings.id });
  if (!updated.length) throw new ServiceError('Die Auswertung gibt es nicht');
}

type Tally = {
  readings: number;
  failed: number;
  good: number;
  bad: number;
  avgMs: number;
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number };
};

export type ReadingStats = Tally & {
  byVersion: (Tally & { version: string; first: Date; last: Date })[];
  byAction: Record<string, number>;
  errors: Record<string, number>;
  tools: Record<string, number>;
};

function tally(rows: AssistantReading[]): Tally {
  const sum = (pick: (row: AssistantReading) => number) =>
    rows.reduce((total, row) => total + pick(row), 0);
  return {
    readings: rows.length,
    failed: rows.filter((row) => row.error !== null).length,
    good: rows.filter((row) => row.rating === 1).length,
    bad: rows.filter((row) => row.rating === -1).length,
    avgMs: rows.length ? Math.round(sum((row) => row.durationMs) / rows.length) : 0,
    tokens: {
      input: sum((row) => row.inputTokens),
      output: sum((row) => row.outputTokens),
      cacheRead: sum((row) => row.cacheReadTokens),
      cacheWrite: sum((row) => row.cacheWriteTokens),
    },
  };
}

function countBy(values: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1]));
}

/**
 * How the readings since a date went, overall and per prompt version (newest version first):
 * how many, how many failed, ratings, time and tokens, and which actions, errors and tools.
 */
export async function readingStats(db: Db, since: Date): Promise<ReadingStats> {
  const rows = await db
    .select()
    .from(assistantReadings)
    .where(gte(assistantReadings.createdAt, since))
    .orderBy(desc(assistantReadings.createdAt));
  const versions = [...Map.groupBy(rows, (row) => row.promptVersion)];
  return {
    ...tally(rows),
    byVersion: versions.map(([version, entries]) => ({
      version,
      first: entries.at(-1)!.createdAt,
      last: entries[0]!.createdAt,
      ...tally(entries),
    })),
    byAction: countBy(rows.map((row) => row.action ?? '(keine)')),
    errors: countBy(rows.flatMap((row) => (row.error ? [row.error] : []))),
    tools: countBy(rows.flatMap((row) => row.toolCalls.map((call) => call.name))),
  };
}

/** Makes `%`, `_` and `\` in a search match themselves. */
function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (char) => `\\${char}`);
}
