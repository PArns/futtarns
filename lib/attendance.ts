import { isWithin, type IsoDate } from '@/lib/dates';
import type { Absence, AttendanceStatus, Member } from '@/lib/db/schema';

export type AttendanceReason = 'answered' | 'absent' | 'silent' | 'guest' | 'inactive';

export type EffectiveAttendance = { status: AttendanceStatus; reason: AttendanceReason };

/** Someone's answer for a Friday as the pages show it. */
export type AttendancePerson = {
  id: number;
  name: string;
  status: AttendanceStatus;
  /** False when the status is only what silence means (or an absence). */
  answered: boolean;
};

/**
 * Whether someone counts for a Friday. On an ordering Friday members who say nothing are
 * in (they get their default dish at the deadline); a flat-price evening like a barbecue
 * needs a yes, because the host shops for it in advance. An absence entered in advance
 * counts as a no; guests, and members outside the Stammtruppe, only count on the Fridays
 * someone added them to.
 */
export function effectiveAttendance(
  member: Pick<Member, 'id' | 'kind' | 'active' | 'core'>,
  friday: IsoDate,
  answer: AttendanceStatus | undefined,
  absences: Pick<Absence, 'memberId' | 'fromDate' | 'toDate'>[],
  silentMeans: AttendanceStatus = 'in'
): EffectiveAttendance {
  if (answer) return { status: answer, reason: 'answered' };
  if (member.kind === 'guest' || !member.core) return { status: 'out', reason: 'guest' };
  if (!member.active) return { status: 'out', reason: 'inactive' };
  const absent = absences.some(
    (absence) =>
      absence.memberId === member.id && isWithin(friday, absence.fromDate, absence.toDate)
  );
  return absent ? { status: 'out', reason: 'absent' } : { status: silentMeans, reason: 'silent' };
}

/** How a pill shows someone's answer: a yes, silence that counts as in, without food, or out. */
export type AnswerKind = 'yes' | 'silent' | 'nofood' | 'out';

export function answerKind(person: Pick<AttendancePerson, 'status' | 'answered'>): AnswerKind {
  if (person.status === 'out') return 'out';
  if (person.status === 'nofood') return 'nofood';
  return person.answered ? 'yes' : 'silent';
}
