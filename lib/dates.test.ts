import { describe, expect, it } from 'vitest';
import {
  addWeeks,
  currentFriday,
  deliveryTime,
  fridaysFrom,
  isFridayIso,
  isIsoDate,
  isPastDeadline,
  orderDeadline,
  orderTime,
  todayIso,
} from '@/lib/dates';

describe('dates', () => {
  it('validates ISO days', () => {
    expect(isIsoDate('2026-10-16')).toBe(true);
    expect(isIsoDate('2026-02-30')).toBe(false);
    expect(isIsoDate('16.10.2026')).toBe(false);
  });

  it('knows Fridays', () => {
    expect(isFridayIso('2026-10-16')).toBe(true);
    expect(isFridayIso('2026-10-17')).toBe(false);
  });

  it('uses Berlin time for today', () => {
    // 23:30 UTC on Thursday is already Friday in Berlin (CEST, UTC+2).
    expect(todayIso(new Date('2026-10-15T23:30:00Z'))).toBe('2026-10-16');
  });

  it('finds the current Friday', () => {
    expect(currentFriday(new Date('2026-10-12T10:00:00Z'))).toBe('2026-10-16');
    expect(currentFriday(new Date('2026-10-16T21:00:00Z'))).toBe('2026-10-16');
    expect(currentFriday(new Date('2026-10-17T10:00:00Z'))).toBe('2026-10-23');
  });

  it('lists Fridays across the switch to winter time', () => {
    expect(fridaysFrom('2026-10-16', 3)).toEqual(['2026-10-16', '2026-10-23', '2026-10-30']);
    expect(addWeeks('2026-10-16', -1)).toBe('2026-10-09');
  });

  it('closes at 19:00, orders at 19:30 and expects the food at 20:30 Berlin time', () => {
    expect(orderDeadline('2026-10-16').toISOString()).toBe('2026-10-16T17:00:00.000Z');
    expect(orderTime('2026-10-16').toISOString()).toBe('2026-10-16T17:30:00.000Z');
    expect(deliveryTime('2026-10-16').toISOString()).toBe('2026-10-16T18:30:00.000Z');
    // After the switch to CET the same local time is an hour later in UTC.
    expect(orderDeadline('2026-10-30').toISOString()).toBe('2026-10-30T18:00:00.000Z');
  });

  it('closes exactly at the deadline', () => {
    expect(isPastDeadline('2026-10-16', new Date('2026-10-16T16:59:59Z'))).toBe(false);
    expect(isPastDeadline('2026-10-16', new Date('2026-10-16T17:00:00Z'))).toBe(true);
  });
});
