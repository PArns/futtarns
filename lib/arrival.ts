/** Rough arrival times offered for „Ich komm später“, after the food is there. */
export const ARRIVAL_TIMES = ['20:00', '20:30', '21:00', '21:30', '22:00', '22:30'] as const;

/** `21`, `21:30`, `21.30` or `21 Uhr` as `21:00` / `21:30`; null when it is no time of day. */
export function parseArrival(text: string): string | null {
  const match = /^(\d{1,2})(?:[:.](\d{2}))?(?:\s*uhr)?$/i.exec(text.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2] ?? 0);
  if (hours > 23 || minutes > 59) return null;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/** `kommt später` or `kommt später (~21:00)`. */
export function lateLabel(arrivesAt: string | null): string {
  return arrivesAt ? `kommt später (~${arrivesAt})` : 'kommt später';
}
