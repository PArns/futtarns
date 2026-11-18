import { describe, expect, it } from 'vitest';
import { chatContext, redactSecrets } from '@/lib/chat';
import { loginCodeText } from '@/lib/messages';

describe('redactSecrets', () => {
  it('blanks out login codes and links, payment and calendar links', () => {
    expect(
      redactSecrets(loginCodeText('012345', 'https://freitach.de/login?phone=%2B49170&code=012345'))
    ).toBe(
      'Dein Code für freitach:\n\n*••••••*\n\nOder direkt anmelden:\nhttps://freitach.de/login?phone=%2B49170&code=…'
    );
    expect(redactSecrets('Hier: https://freitach.de/login/AbCdEfGhIjKlMnOpQrStUvWxYz012345')).toBe(
      'Hier: https://freitach.de/login/…'
    );
    expect(
      redactSecrets('Abhaken: https://freitach.de/bezahlt/2026-10-16.7.AbCdEfGhIjKlMnOpQrStUv')
    ).toBe('Abhaken: https://freitach.de/bezahlt/…');
    expect(redactSecrets('https://freitach.de/ics/AbCdEfGhIjKlMnOpQrStUvWx.ics')).toBe(
      'https://freitach.de/ics/….ics'
    );
  });

  it('leaves everything else as it was', () => {
    const text = 'Für Freitag sind noch *12,50 €* offen: https://freitach.de/freitag/2026-10-16';
    expect(redactSecrets(text)).toBe(text);
  });
});

describe('chatContext', () => {
  it('names who said what, oldest first, and shortens long messages', () => {
    const at = new Date('2026-10-14T12:00:00Z');
    const context = chatContext(
      [
        { direction: 'in', text: 'Was gibt’s?', createdAt: at },
        { direction: 'out', text: 'x'.repeat(500), createdAt: at },
      ],
      'Anna'
    );
    const [first, second] = context.split('\n');
    expect(first).toMatch(/^\[.+14:00\] Anna: Was gibt’s\?$/);
    expect(second).toMatch(/^\[.+\] Bot: x{399}…$/);
  });
});
