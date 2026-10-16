import { describe, expect, it } from 'vitest';
import { normalizePaypalHandle, paypalAmount, paypalMeLink } from '@/lib/paypal';

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

  it('writes the amount as it is typed into PayPal', () => {
    expect(paypalAmount(1234)).toBe('12,34');
    expect(paypalAmount(500)).toBe('5,00');
  });
});
