import { describe, expect, it } from 'vitest';
import { effectiveAttendance } from '@/lib/attendance';

const member = { id: 1, kind: 'member' as const, active: true };
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

  it('only counts guests where they were added', () => {
    const guest = { ...member, kind: 'guest' as const };
    expect(effectiveAttendance(guest, '2026-10-16', undefined, []).status).toBe('out');
    expect(effectiveAttendance(guest, '2026-10-16', 'in', []).status).toBe('in');
  });
});
