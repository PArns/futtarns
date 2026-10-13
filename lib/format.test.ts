import { describe, expect, it } from 'vitest';
import { formatCountdown, formatWeekdayTime } from '@/lib/format';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

describe('formatCountdown', () => {
  it('counts the last hour down to the second', () => {
    expect(formatCountdown(42_000)).toBe('in 0:42 Min');
    expect(formatCountdown(12 * MINUTE + 5_000)).toBe('in 12:05 Min');
    expect(formatCountdown(-1)).toBe('in 0:00 Min');
  });

  it('gives hours and minutes within a day, then days', () => {
    expect(formatCountdown(3 * HOUR + 5 * MINUTE)).toBe('in 3 Std. 5 Min.');
    expect(formatCountdown(2 * HOUR)).toBe('in 2 Std.');
    expect(formatCountdown(27 * HOUR)).toBe('in 1 Tag 3 Std.');
    expect(formatCountdown(48 * HOUR)).toBe('in 2 Tagen');
    expect(formatCountdown(4 * 24 * HOUR + 5 * HOUR)).toBe('in 4 Tagen');
  });
});

describe('formatWeekdayTime', () => {
  it('shows the weekday and Berlin time', () => {
    expect(formatWeekdayTime(new Date('2026-10-16T08:00:00Z'))).toBe('Fr., 10:00');
  });
});
