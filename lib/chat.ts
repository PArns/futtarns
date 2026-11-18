import type { ChatDirection } from '@/lib/db/schema';
import { formatWeekdayTime } from '@/lib/format';

/**
 * The bot's chats with the members: what is kept, and what Claude reads of them. The
 * database side is `lib/services/chats.ts`.
 */

/** How many days the chats are kept; older messages go on the scheduler's next pass. */
export const CHAT_DAYS = 30;

/** How far back Claude reads the chat along with a new message. */
export const CONTEXT_HOURS = 12;

/** At most this many earlier messages go along with a new one. */
export const CONTEXT_MESSAGES = 10;

/** The longest part of one earlier message Claude reads. */
const CONTEXT_CHARS = 400;

/**
 * Blanks out what would let someone sign in or book a payment as someone else: login links
 * and codes, payment and calendar links. The rest of the message stays as it was sent.
 */
export function redactSecrets(text: string): string {
  return text
    .replace(/(\/login\/)[\w-]{16,}/g, '$1…')
    .replace(/([?&]code=)\d+/g, '$1…')
    .replace(/(\/bezahlt\/)[\w.-]{16,}/g, '$1…')
    .replace(/(\/ics\/)[\w-]{16,}/g, '$1…')
    .replace(/\*\d{6}\*/g, '*••••••*');
}

export type ChatLine = { direction: ChatDirection; text: string; createdAt: Date };

/**
 * The chat so far, oldest first, as Claude reads it with a new message: when, who, and what
 * was said, each message cut to a few hundred characters.
 */
export function chatContext(lines: ChatLine[], name: string): string {
  return lines
    .map((line) => {
      const said = line.text.trim();
      const text = said.length > CONTEXT_CHARS ? `${said.slice(0, CONTEXT_CHARS - 1)}…` : said;
      return `[${formatWeekdayTime(line.createdAt)}] ${line.direction === 'in' ? name : 'Bot'}: ${text}`;
    })
    .join('\n');
}
