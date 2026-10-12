import { describe, expect, it } from 'vitest';
import { formatPhone, normalizePhone } from '@/lib/phone';

describe('normalizePhone', () => {
  it.each([
    ['0170 1234567', '+491701234567'],
    ['+49 (0)170 123-45-67', '+491701234567'],
    ['0049 170 1234567', '+491701234567'],
    ['+31 6 12345678', '+31612345678'],
    ['491701234567', '+491701234567'],
  ])('reads %s', (input, expected) => expect(normalizePhone(input)).toBe(expected));

  it.each(['', '12', 'abc', '+49'])('rejects %s', (input) =>
    expect(normalizePhone(input)).toBeNull()
  );

  it('formats German numbers for display', () => {
    expect(formatPhone('+491701234567')).toBe('+49 170 1234567');
  });
});
