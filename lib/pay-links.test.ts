import { describe, expect, it } from 'vitest';
import { payLinkToken, readPayLinkToken } from '@/lib/pay-links';

const SECRET = 'test-secret';

describe('payment link tokens', () => {
  it('read back the Friday and the person they were made for', () => {
    const token = payLinkToken(SECRET, '2026-10-16', 7);
    expect(readPayLinkToken(SECRET, token)).toEqual({ date: '2026-10-16', memberId: 7 });
  });

  it('refuse a changed person, another secret and a day that is no Friday', () => {
    const token = payLinkToken(SECRET, '2026-10-16', 7);
    expect(readPayLinkToken(SECRET, token.replace('.7.', '.8.'))).toBeNull();
    expect(readPayLinkToken('other-secret', token)).toBeNull();
    expect(readPayLinkToken(SECRET, payLinkToken(SECRET, '2026-10-15', 7))).toBeNull();
    expect(readPayLinkToken(SECRET, 'nonsense')).toBeNull();
  });
});
