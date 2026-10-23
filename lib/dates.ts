import { TZDate } from '@date-fns/tz';
import { addDays, nextFriday as nextFridayAfter, isFriday } from 'date-fns';

export const TIME_ZONE = 'Europe/Berlin';
/** When the order goes out on a Friday, Berlin time. */
export const ORDER_HOUR = 19;
export const ORDER_MINUTE = 45;
/** Orders and cancellations close this many minutes before the order goes out. */
export const DEADLINE_MINUTES_BEFORE = 15;
/** The restaurants take about an hour, so the food arrives around 20:45. */
export const DELIVERY_MINUTES_AFTER_ORDER = 60;

/** A calendar day as `YYYY-MM-DD`, the format the database stores. */
export type IsoDate = string;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: string): value is IsoDate {
  if (!ISO_DATE.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number) as [number, number, number];
  const check = new Date(Date.UTC(year, month - 1, day));
  return check.getUTCMonth() === month - 1 && check.getUTCDate() === day;
}

function toIso(date: Date): IsoDate {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function berlinDay(iso: IsoDate): TZDate {
  const [year, month, day] = iso.split('-').map(Number) as [number, number, number];
  return new TZDate(year, month - 1, day, TIME_ZONE);
}

export function todayIso(now: Date = new Date()): IsoDate {
  return toIso(new TZDate(now, TIME_ZONE));
}

export function isFridayIso(iso: IsoDate): boolean {
  return isIsoDate(iso) && isFriday(berlinDay(iso));
}

/** The Friday everything is currently about: today on a Friday, otherwise the next one. */
export function currentFriday(now: Date = new Date()): IsoDate {
  const today = new TZDate(now, TIME_ZONE);
  return toIso(isFriday(today) ? today : nextFridayAfter(today));
}

/** `count` Fridays starting at `from` (which must itself be a Friday). */
export function fridaysFrom(from: IsoDate, count: number): IsoDate[] {
  const start = berlinDay(from);
  return Array.from({ length: count }, (_, week) => toIso(addDays(start, week * 7)));
}

export function addWeeks(iso: IsoDate, weeks: number): IsoDate {
  return toIso(addDays(berlinDay(iso), weeks * 7));
}

/** The moment the order goes out on that Friday. */
export function orderTime(friday: IsoDate): Date {
  const day = berlinDay(friday);
  const local = new TZDate(
    day.getFullYear(),
    day.getMonth(),
    day.getDate(),
    ORDER_HOUR,
    ORDER_MINUTE,
    TIME_ZONE
  );
  return new Date(local.getTime());
}

export function deliveryTime(friday: IsoDate): Date {
  return new Date(orderTime(friday).getTime() + DELIVERY_MINUTES_AFTER_ORDER * 60_000);
}

/** Last moment to order, change an order or cancel for that Friday. */
export function orderDeadline(friday: IsoDate): Date {
  return new Date(orderTime(friday).getTime() - DEADLINE_MINUTES_BEFORE * 60_000);
}

export function isPastDeadline(friday: IsoDate, now: Date = new Date()): boolean {
  return now.getTime() >= orderDeadline(friday).getTime();
}

/** A Berlin wall-clock time relative to a Friday, e.g. Wednesday noon is (-2, 12, 0). */
export function berlinAt(friday: IsoDate, dayOffset: number, hour: number, minute = 0): Date {
  const day = addDays(berlinDay(friday), dayOffset);
  const local = new TZDate(
    day.getFullYear(),
    day.getMonth(),
    day.getDate(),
    hour,
    minute,
    TIME_ZONE
  );
  return new Date(local.getTime());
}

/** Whole calendar days from `from` to `to`. */
export function daysBetween(from: IsoDate, to: IsoDate): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export function isWithin(iso: IsoDate, from: IsoDate, to: IsoDate): boolean {
  return from <= iso && iso <= to;
}
