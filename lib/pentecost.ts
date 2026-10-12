import { berlinAt, todayIso, type IsoDate } from '@/lib/dates';

/** Easter Sunday of the Gregorian calendar (the anonymous Gregorian algorithm). */
export function easterSunday(year: number): IsoDate {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function plusDays(iso: IsoDate, days: number): IsoDate {
  return todayIso(berlinAt(iso, days, 12));
}

export type HollandTrip = {
  /** The Friday before Pentecost, when we leave. */
  friday: IsoDate;
  /** The Tuesday after Whit Monday, when we come back. */
  tuesday: IsoDate;
  start: Date;
  end: Date;
};

/** The Pentecost weekend in Holland: Friday before Pentecost through the Tuesday after. */
export function hollandTrip(year: number): HollandTrip {
  const friday = plusDays(easterSunday(year), 49 - 2);
  return {
    friday,
    tuesday: plusDays(friday, 4),
    start: berlinAt(friday, 0, 0),
    end: berlinAt(friday, 5, 0),
  };
}

/** The trip that is on right now, or else the next one. */
export function nextHollandTrip(now: Date): HollandTrip {
  const year = Number(todayIso(now).slice(0, 4));
  const trip = hollandTrip(year);
  return now < trip.end ? trip : hollandTrip(year + 1);
}

export function isHollandFriday(date: IsoDate): boolean {
  return hollandTrip(Number(date.slice(0, 4))).friday === date;
}

/** What is left until we leave, in whole days, hours, minutes and seconds. */
export function timeUntil(trip: HollandTrip, now: number) {
  const seconds = Math.floor(Math.max(trip.start.getTime() - now, 0) / 1000);
  return {
    days: Math.floor(seconds / 86_400),
    hours: Math.floor(seconds / 3600) % 24,
    minutes: Math.floor(seconds / 60) % 60,
    seconds: seconds % 60,
  };
}
