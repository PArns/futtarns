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
