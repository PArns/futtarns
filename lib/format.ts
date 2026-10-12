import { TIME_ZONE, type IsoDate } from '@/lib/dates';

// Formatters are built once; constructing Intl objects per render is measurably slow.
const euro = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });
const dayMonth = new Intl.DateTimeFormat('de-DE', {
  day: 'numeric',
  month: 'long',
  timeZone: 'UTC',
});
const dayMonthShort = new Intl.DateTimeFormat('de-DE', {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});
const weekdayDayMonth = new Intl.DateTimeFormat('de-DE', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});
const monthYear = new Intl.DateTimeFormat('de-DE', {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});
const time = new Intl.DateTimeFormat('de-DE', {
  hour: '2-digit',
  minute: '2-digit',
  timeZone: TIME_ZONE,
});

// An ISO day is a calendar date, not an instant, so it is read and formatted as UTC noon.
function isoToUtc(iso: IsoDate): Date {
  return new Date(`${iso}T12:00:00Z`);
}

export function formatEuro(cents: number): string {
  return euro.format(cents / 100);
}

/** `16. Oktober` */
export function formatDay(iso: IsoDate): string {
  return dayMonth.format(isoToUtc(iso));
}

/** `16. Okt.` */
export function formatDayShort(iso: IsoDate): string {
  return dayMonthShort.format(isoToUtc(iso));
}

/** `Fr., 16. Okt.` */
export function formatWeekdayDay(iso: IsoDate): string {
  return weekdayDayMonth.format(isoToUtc(iso));
}

/** `Oktober 2026` */
export function formatMonth(iso: IsoDate): string {
  return monthYear.format(isoToUtc(iso));
}

/** `19:00`, Berlin time. */
export function formatTime(date: Date): string {
  return time.format(date);
}

/** Cents as the editable form value `12,50`. */
export function centsToInput(cents: number | null): string {
  if (cents === null) return '';
  return (cents / 100).toFixed(2).replace('.', ',');
}
