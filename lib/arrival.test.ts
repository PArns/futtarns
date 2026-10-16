import { describe, expect, it } from 'vitest';
import { lateLabel, parseArrival } from '@/lib/arrival';

describe('parseArrival', () => {
  it.each([
    ['21', '21:00'],
    ['21:30', '21:30'],
    ['21.30', '21:30'],
    ['9 Uhr', '09:00'],
    [' 22 uhr ', '22:00'],
  ])('reads %s', (text, time) => expect(parseArrival(text)).toBe(time));

  it.each(['', 'gleich', '25', '21:75', '2130'])('rejects %s', (text) =>
    expect(parseArrival(text)).toBeNull()
  );
});

describe('lateLabel', () => {
  it('names the time when there is one', () => {
    expect(lateLabel('21:00')).toBe('kommt später (~21:00)');
    expect(lateLabel(null)).toBe('kommt später');
  });
});
