/**
 * Reduces whatever someone typed as their PayPal.me (a full link, `@name` or the bare
 * name) to the handle, or null when it cannot be one.
 */
export function normalizePaypalHandle(input: string): string | null {
  const handle = input
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/^(www\.)?paypal\.me\//i, '')
    .replace(/^@/, '')
    .split(/[/?#]/)[0]!;
  return /^[A-Za-z0-9._-]{1,64}$/.test(handle) ? handle : null;
}

/** A PayPal.me link that opens with the amount filled in. */
export function paypalMeLink(handle: string, amountCents: number): string {
  const euros = (amountCents / 100).toFixed(2);
  return `https://paypal.me/${encodeURIComponent(handle)}/${euros}EUR`;
}
