import { describe, expect, it } from 'vitest';
import { easterSunday, hollandTrip, isHollandFriday, nextHollandTrip } from '@/lib/pentecost';

describe('Pentecost in Holland', () => {
  it('finds Easter', () => {
    expect(['2024', '2025', '2026', '2027', '2028', '2038'].map(Number).map(easterSunday)).toEqual([
      '2024-03-31',
      '2025-04-20',
      '2026-04-05',
      '2027-03-28',
      '2028-04-16',
      '2038-04-25',
    ]);
  });

  it('runs from the Friday before Pentecost to the Tuesday after', () => {
    expect(hollandTrip(2027)).toMatchObject({ friday: '2027-05-14', tuesday: '2027-05-18' });
    expect(hollandTrip(2026).start.toISOString()).toBe('2026-05-21T22:00:00.000Z');
    expect(isHollandFriday('2027-05-14')).toBe(true);
    expect(isHollandFriday('2027-05-07')).toBe(false);
  });

  it('counts towards next year once we are back', () => {
    expect(nextHollandTrip(new Date('2026-10-12T10:00:00Z')).friday).toBe('2027-05-14');
    expect(nextHollandTrip(new Date('2027-05-18T20:00:00Z')).friday).toBe('2027-05-14');
    expect(nextHollandTrip(new Date('2027-05-18T22:30:00Z')).friday).toBe('2028-06-02');
  });
});
