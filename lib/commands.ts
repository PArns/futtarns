import type { AttendanceStatus } from '@/lib/db/schema';
import { bold } from '@/lib/messages';

export type Command =
  | { kind: 'answer'; status: AttendanceStatus; confirmed: boolean }
  | { kind: 'usual' }
  | { kind: 'others' }
  | { kind: 'paid' }
  | { kind: 'login' }
  | { kind: 'status' }
  | { kind: 'help' }
  | { kind: 'unknown' };

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
  [/^(andere|die anderen|wer isst was|was essen die anderen|bestellungen)$/, { kind: 'others' }],
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
  const normalized = text
    .toLowerCase()
    .replace(/[.!,;:"„“]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const confirmed = / sicher$/.test(normalized);
  const plain = normalized.replace(/ sicher$/, '');
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
  `${bold('andere')} – was essen die anderen?`,
  `${bold('bezahlt')} – ich hab gezahlt`,
  `${bold('status')} – was gibt’s am Freitag?`,
  `${bold('code')} – Login-Code für die Webseite`,
].join('\n');
