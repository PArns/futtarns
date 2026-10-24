let pinned = false;

/** Tests pin every message to its first wording, so they can check what it says. */
export function pinWording(pin = true) {
  pinned = pin;
}

/**
 * One of several wordings of the same message, so not everyone gets the same joke. The
 * message's key picks it, so the host's preview and the message sent say the same.
 */
export function pick<T>(wordings: readonly [T, ...T[]], key: string): T {
  if (pinned) return wordings[0];
  let hash = 2166136261;
  for (const char of key) hash = Math.imul(hash ^ char.codePointAt(0)!, 16777619);
  return wordings[(hash >>> 0) % wordings.length]!;
}

/** WhatsApp shows text between asterisks in bold. */
export function bold(text: string): string {
  return `*${text}*`;
}

/**
 * The login code on a line of its own, so it is easy to copy; with `link`, the one-tap
 * login underneath.
 */
export function loginCodeText(code: string, link?: string): string {
  return [
    'Dein Code für freitach:',
    '',
    bold(code),
    '',
    link ? `Oder direkt anmelden:\n${link}` : 'Er gilt 10 Minuten.',
  ].join('\n');
}
