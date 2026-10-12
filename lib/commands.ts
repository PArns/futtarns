import type { AttendanceStatus } from '@/lib/db/schema';

export type Command =
  | { kind: 'answer'; status: AttendanceStatus }
  | { kind: 'paid' }
  | { kind: 'login' }
  | { kind: 'status' }
  | { kind: 'help' }
  | { kind: 'unknown' };

const WORDS: [RegExp, Command][] = [
  [/^(1|ja|jo|dabei|bin dabei|ich bin dabei|👍)$/, { kind: 'answer', status: 'in' }],
  [
    /^(2|ohne essen|nix essen|kein essen|komme ohne essen|komme ess nix|ess nix|esse nix)$/,
    { kind: 'answer', status: 'nofood' },
  ],
  [/^(3|nein|ne|nö|raus|bin raus|ich bin raus|👎)$/, { kind: 'answer', status: 'out' }],
  [/^(bezahlt|gezahlt|hab bezahlt|habe bezahlt|paid|überwiesen)$/, { kind: 'paid' }],
  [/^(login|code|link|anmelden|einloggen)$/, { kind: 'login' }],
  [/^(status|info|was gibts|was gibt es|\?)$/, { kind: 'status' }],
  [/^(hilfe|help|menü|menu|befehle)$/, { kind: 'help' }],
];

/** Reads a WhatsApp reply into what the person meant; punctuation and case do not matter. */
export function parseCommand(text: string): Command {
  const normalized = text
    .toLowerCase()
    .replace(/[.!,;:"„“]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return WORDS.find(([pattern]) => pattern.test(normalized))?.[1] ?? { kind: 'unknown' };
}

export const HELP_TEXT = [
  'So kannst du mir antworten:',
  '1 – bin dabei',
  '2 – komme, esse aber nix',
  '3 – bin raus',
  'bezahlt – ich hab gezahlt',
  'status – was gibt’s am Freitag?',
  'code – Login-Code für die Webseite',
].join('\n');
