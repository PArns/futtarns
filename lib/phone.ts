/**
 * Brings a phone number as people type it into E.164 (`+491701234567`). German numbers
 * may be written nationally (`0170 …`); anything else needs its country code.
 */
export function normalizePhone(input: string): string | null {
  let digits = input.trim().replace(/[\s()/.-]/g, '');
  if (digits.startsWith('00')) digits = `+${digits.slice(2)}`;
  else if (digits.startsWith('0')) digits = `+49${digits.slice(1)}`;
  else if (!digits.startsWith('+')) digits = `+${digits}`;
  digits = digits.replace(/^\+490/, '+49');
  return /^\+[1-9]\d{7,14}$/.test(digits) ? digits : null;
}

/** `+49 170 1234567` for showing a stored number. */
export function formatPhone(e164: string): string {
  // German mobile prefixes are 15x, 16x and 17x; landlines vary too much to split.
  const match = /^\+49(1[5-7]\d)(\d+)$/.exec(e164);
  return match ? `+49 ${match[1]} ${match[2]}` : e164.replace(/^\+49/, '+49 ');
}
