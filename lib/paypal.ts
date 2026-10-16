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

/**
 * A PayPal.me link with the amount, as PayPal documents it (`paypal.me/name/25EUR`). The
 * website fills the amount in; the PayPal app, which opens these links on a phone, does not
 * always, so the amount is shown next to the link as well (`paypalAmount`).
 */
export function paypalMeLink(handle: string, amountCents: number): string {
  const euros = (amountCents / 100).toFixed(2);
  return `https://paypal.me/${encodeURIComponent(handle)}/${euros}EUR`;
}

/** The amount as it is typed into PayPal, `12,34`, for when the app leaves it empty. */
export function paypalAmount(amountCents: number): string {
  return (amountCents / 100).toFixed(2).replace('.', ',');
}
