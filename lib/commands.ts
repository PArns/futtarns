import type { AttendanceStatus } from '@/lib/db/schema';
import { parseArrival } from '@/lib/arrival';
import type { IsoDate } from '@/lib/dates';
import { bold } from '@/lib/messages';
import { VOTE_CLOSE_HOUR } from '@/lib/vote';

export type Command =
  | { kind: 'answer'; status: AttendanceStatus; confirmed: boolean }
  | { kind: 'usual' }
  /** The same as last time at this restaurant. */
  | { kind: 'same' }
  /** „Ich komm später“, maybe with a rough time (`21:30`). */
  | { kind: 'late'; arrivesAt: string | null }
  /** Comes on time after all. */
  | { kind: 'onTime' }
  | { kind: 'others' }
  /** Steps in as host on a Friday without one, or whose host is away. */
  | { kind: 'takeOver' }
  /** The host or an admin settles the restaurant, through the assistant; it ends the vote. */
  | { kind: 'pickRestaurant'; restaurantId: number; confirmed: boolean }
  /**
   * Only through the assistant (`lib/assistant.ts`); no text parses to these. A dish by its
   * number with the choices Claude picked, checked against the menu when it runs.
   */
  | {
      kind: 'order';
      dishId: number;
      options: { group: string; choice: string }[];
      /** Takes out what they ordered at that restaurant first. */
      replace: boolean;
    }
  | { kind: 'removeOrder'; itemId: number | null; confirmed: boolean }
  | { kind: 'setDefault'; dishId: number; options: { group: string; choice: string }[] }
  | { kind: 'drinks'; on: boolean }
  | { kind: 'absence'; from: IsoDate; to: IsoDate }
  | { kind: 'paid' }
  | { kind: 'login' }
  | { kind: 'status' }
  | { kind: 'help' }
  /** A letter from the restaurant vote's ballot. */
  | { kind: 'vote'; letter: string }
  /** An answer and a ballot letter in one go: `1E`, `1 E`, `E1` or `E 1`. */
  | {
      kind: 'answerVote';
      status: Exclude<AttendanceStatus, 'out'>;
      letter: string;
      confirmed: boolean;
    }
  | { kind: 'unknown' };

/** `später`, `ich komm später`, `später 21`, `komme später gegen 21:30 Uhr`. */
const LATE =
  /^(?:ich )?(?:komm(?:e)? )?später(?: (?:so |erst )?(?:um |gegen |ca\.? ?|ab )?(\d{1,2}(?:[:.]\d{2})?(?: ?uhr)?))?$/;

const WORDS: [RegExp, Command][] = [
  [
    /^(1|ja|jo|dabei|bin dabei|ich bin dabei|👍)$/,
    { kind: 'answer', status: 'in', confirmed: false },
  ],
  [
    /^(2|ohne essen|nix essen|kein essen|komme ohne essen|komme ess nix|ess nix|esse nix)$/,
    { kind: 'answer', status: 'nofood', confirmed: false },
  ],
  [
    /^(3|nein|ne|nö|raus|bin raus|ich bin raus|👎)$/,
    { kind: 'answer', status: 'out', confirmed: false },
  ],
  [/^(wie immer|wieimmer|das übliche|das uebliche|standard)$/, { kind: 'usual' }],
  [
    /^(gleiches|das gleiche|dasselbe|das selbe|gleiche wie letztes mal|wie letztes mal|wie letzte woche|nochmal das gleiche)$/,
    { kind: 'same' },
  ],
  [/^(pünktlich|doch pünktlich|bin pünktlich|komme pünktlich)$/, { kind: 'onTime' }],
  [/^(andere|die anderen|wer isst was|was essen die anderen|bestellungen)$/, { kind: 'others' }],
  [/^(übernehme|ich übernehme|übernehmen|ich bin gastgeber)$/, { kind: 'takeOver' }],
  [/^(bezahlt|gezahlt|hab bezahlt|habe bezahlt|paid|überwiesen)$/, { kind: 'paid' }],
  [/^(login|code|link|anmelden|einloggen)$/, { kind: 'login' }],
  [/^(status|info|was gibts|was gibt es|\?)$/, { kind: 'status' }],
  [/^(hilfe|help|menü|menu|befehle)$/, { kind: 'help' }],
];

/**
 * Reads a WhatsApp reply into what the person meant; punctuation and case do not matter.
 * A trailing „sicher“ confirms an answer that would throw away an order.
 */
export function parseCommand(text: string): Command {
  // Read before the times lose their colon to the clean-up below.
  const late = LATE.exec(
    text
      .toLowerCase()
      .replace(/[!,;"„“]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/\.$/, '')
  );
  if (late) return { kind: 'late', arrivesAt: late[1] ? parseArrival(late[1]) : null };
  const normalized = text
    .toLowerCase()
    .replace(/[.!,;:"„“]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const confirmed = / sicher$/.test(normalized);
  const plain = normalized.replace(/ sicher$/, '');
  if (/^[a-z]$/.test(plain)) return { kind: 'vote', letter: plain };
  // A vote is a yes, so only „dabei“ and „ohne Essen“ go with a letter, in either order.
  const digitFirst = /^([12]) ?([a-z])$/.exec(plain);
  const letterFirst = /^([a-z]) ?([12])$/.exec(plain);
  const both = digitFirst
    ? { digit: digitFirst[1], letter: digitFirst[2]! }
    : letterFirst
      ? { digit: letterFirst[2], letter: letterFirst[1]! }
      : null;
  if (both) {
    return {
      kind: 'answerVote',
      status: both.digit === '1' ? 'in' : 'nofood',
      letter: both.letter,
      confirmed,
    };
  }
  const command = WORDS.find(([pattern]) => pattern.test(plain))?.[1] ?? { kind: 'unknown' };
  return command.kind === 'answer' ? { ...command, confirmed } : command;
}

export const HELP_TEXT = [
  bold('So kannst du mir antworten:'),
  '',
  `${bold('1')} – bin dabei`,
  `${bold('2')} – komme, esse aber nix`,
  `${bold('3')} – bin raus`,
  `${bold('wie immer')} – bin dabei, mit meinem Standardgericht`,
  `${bold('gleiches')} – bin dabei, mit dem, was ich letztes Mal hier hatte`,
  `${bold('später 21')} – ich komm später (gegen 21 Uhr), mein Essen wird später bestellt`,
  `${bold('andere')} – was essen die anderen?`,
  `${bold('A')}, ${bold('B')}, … – Restaurant wählen (bis Freitag ${VOTE_CLOSE_HOUR}:00)`,
  `${bold('1B')} – bin dabei und wähle B, alles in einem (${bold('B1')} geht auch)`,
  `${bold('übernehme')} – ich mach den Gastgeber, wenn keiner da ist`,
  `${bold('bezahlt')} – ich hab gezahlt`,
  `${bold('status')} – was gibt’s am Freitag?`,
  `${bold('code')} – Login-Code für die Webseite`,
].join('\n');
