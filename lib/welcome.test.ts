import { describe, expect, it } from 'vitest';
import { welcomeText } from '@/lib/welcome';

describe('welcomeText', () => {
  it('greets, links and names the deadline', () => {
    const text = welcomeText({ name: 'Anna', invitedBy: 'Patrick', link: 'https://x/login/abc' });
    expect(text).toMatch(/^🍕 Hi Anna, willkommen bei freitach!/);
    expect(text).toContain('Patrick hat dich eingetragen');
    expect(text).toContain('https://x/login/abc');
    expect(text).toContain('Bestellschluss ist freitags um 19:00 Uhr, gegessen wird gegen 20:30.');
  });
});
