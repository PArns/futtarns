import { isWithin, type IsoDate } from '@/lib/dates';
import type { Absence, AttendanceStatus, Member } from '@/lib/db/schema';

export type AttendanceReason = 'answered' | 'absent' | 'silent' | 'guest' | 'inactive';

export type EffectiveAttendance = { status: AttendanceStatus; reason: AttendanceReason };

/**
 * Whether someone counts for a Friday. Members who say nothing are in (they get their
 * default dish at the deadline); an absence entered in advance counts as a no; guests
 * only count on the Fridays someone added them to.
 */
export function effectiveAttendance(
  member: Pick<Member, 'id' | 'kind' | 'active'>,
  friday: IsoDate,
  answer: AttendanceStatus | undefined,
  absences: Pick<Absence, 'memberId' | 'fromDate' | 'toDate'>[]
): EffectiveAttendance {
  if (answer) return { status: answer, reason: 'answered' };
  if (member.kind === 'guest') return { status: 'out', reason: 'guest' };
  if (!member.active) return { status: 'out', reason: 'inactive' };
  const absent = absences.some(
    (absence) => absence.memberId === member.id && isWithin(friday, absence.fromDate, absence.toDate)
  );
  return absent ? { status: 'out', reason: 'absent' } : { status: 'in', reason: 'silent' };
}
