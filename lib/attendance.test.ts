import { describe, expect, it } from 'vitest';
import { effectiveAttendance, hostLast, isAway } from '@/lib/attendance';

const member = { id: 1, kind: 'member' as const, active: true, core: true };
const away = [{ memberId: 1, fromDate: '2026-10-10', toDate: '2026-10-20' }];

describe('effectiveAttendance', () => {
  it('counts a silent member as coming', () => {
    expect(effectiveAttendance(member, '2026-10-23', undefined, away)).toEqual({
      status: 'in',
      reason: 'silent',
    });
  });

  it('counts an absence as a no', () => {
    expect(effectiveAttendance(member, '2026-10-16', undefined, away).status).toBe('out');
  });

  it('lets an answer beat the absence', () => {
    expect(effectiveAttendance(member, '2026-10-16', 'in', away).status).toBe('in');
  });

  it('needs a yes on a flat-price evening', () => {
    expect(effectiveAttendance(member, '2026-10-23', undefined, [], 'out')).toEqual({
      status: 'out',
      reason: 'silent',
    });
  });

  it('only counts guests where they were added', () => {
    const guest = { ...member, kind: 'guest' as const };
    expect(effectiveAttendance(guest, '2026-10-16', undefined, []).status).toBe('out');
    expect(effectiveAttendance(guest, '2026-10-16', 'in', []).status).toBe('in');
  });

  it('counts someone outside the Stammtruppe only on the Fridays they were added to', () => {
    const visitor = { ...member, core: false };
    expect(effectiveAttendance(visitor, '2026-10-23', undefined, [])).toEqual({
      status: 'out',
      reason: 'guest',
    });
    expect(effectiveAttendance(visitor, '2026-10-16', 'in', []).status).toBe('in');
  });
});

describe('isAway', () => {
  it('follows the absence while there is no yes for the day', () => {
    expect(isAway(1, '2026-10-16', undefined, away)).toBe(true);
    expect(isAway(1, '2026-10-16', 'out', away)).toBe(true);
    expect(isAway(1, '2026-10-23', undefined, away)).toBe(false);
    expect(isAway(2, '2026-10-16', undefined, away)).toBe(false);
  });

  it('lets a yes for the day beat the absence, with or without food', () => {
    expect(isAway(1, '2026-10-16', 'in', away)).toBe(false);
    expect(isAway(1, '2026-10-16', 'nofood', away)).toBe(false);
  });
});

describe('hostLast', () => {
  const people = [{ id: 1 }, { id: 2 }, { id: 3 }];
  const id = (person: { id: number }) => person.id;

  it('moves the host to the end and keeps the others in order', () => {
    expect(hostLast(people, 1, id).map(id)).toEqual([2, 3, 1]);
  });

  it('leaves the list alone without a host among them', () => {
    expect(hostLast(people, null, id).map(id)).toEqual([1, 2, 3]);
    expect(hostLast(people, 9, id).map(id)).toEqual([1, 2, 3]);
  });
});
