import { and, eq } from 'drizzle-orm';
import { isPastDeadline, type IsoDate } from '@/lib/dates';
import type { Db } from '@/lib/db/client';
import { attendance, type Member } from '@/lib/db/schema';
import { canEditOrderOf, canManageFriday } from '@/lib/permissions';
import { getFridayRow, hostIdFor } from '@/lib/services/fridays';
import { ServiceError } from '@/lib/services/members';

/**
 * The permission checks every way in shares (the page's server actions, the MCP tools),
 * looked up fresh from the database rather than taken from what the caller sends.
 */

/**
 * Whether `viewer` may change the answer and order of `targetId` on a Friday: their own and
 * their guests' until the deadline, everyone's for whoever runs it, nobody's once settled.
 * Throws with the reason; returns the Friday's host.
 */
export async function requireOrderAccess(
  db: Db,
  viewer: Member,
  date: IsoDate,
  targetId: number,
  now: Date = new Date()
): Promise<{ hostId: number | null }> {
  const row = await getFridayRow(db, date);
  const hostId = await hostIdFor(db, date);
  const [answer] = await db
    .select({ addedById: attendance.addedById })
    .from(attendance)
    .where(and(eq(attendance.fridayDate, date), eq(attendance.memberId, targetId)));
  const state = {
    locked: Boolean(row?.lockedAt) || isPastDeadline(date, now),
    settled: Boolean(row?.settledAt),
  };
  if (row?.cancelled) throw new ServiceError('Dieser Freitag fällt aus');
  if (
    !canEditOrderOf(viewer, { id: targetId, addedById: answer?.addedById ?? null }, hostId, state)
  ) {
    throw new ServiceError(
      state.settled
        ? 'Schon abgerechnet – der Gastgeber kann die Abrechnung wieder öffnen'
        : state.locked
          ? 'Bestellschluss ist vorbei – sag dem Gastgeber Bescheid'
          : 'Das darfst du nicht ändern'
    );
  }
  return { hostId };
}

/** Whether `viewer` runs this Friday: its host or an admin. Throws if not; returns the host. */
export async function requireFridayManager(
  db: Db,
  viewer: Member,
  date: IsoDate
): Promise<{ hostId: number | null }> {
  const hostId = await hostIdFor(db, date);
  if (!canManageFriday(viewer, hostId)) throw new ServiceError('Das darf nur der Gastgeber');
  return { hostId };
}
