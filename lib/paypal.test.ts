import { describe, expect, it } from 'vitest';
import { normalizePaypalHandle, paypalMeLink } from '@/lib/paypal';

describe('paypal', () => {
  it.each([
    ['patrickarns', 'patrickarns'],
    ['@patrickarns', 'patrickarns'],
    ['https://paypal.me/patrickarns', 'patrickarns'],
    ['www.paypal.me/patrickarns/10EUR', 'patrickarns'],
  ])('reads %s', (input, handle) => expect(normalizePaypalHandle(input)).toBe(handle));

  it('rejects what cannot be a handle', () => {
    expect(normalizePaypalHandle('')).toBeNull();
    expect(normalizePaypalHandle('two words')).toBeNull();
  });

  it('builds a link with the amount', () => {
    expect(paypalMeLink('patrickarns', 1234)).toBe('https://paypal.me/patrickarns/12.34EUR');
    expect(paypalMeLink('patrickarns', 500)).toBe('https://paypal.me/patrickarns/5.00EUR');
  });
});
