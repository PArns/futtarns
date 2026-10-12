import type { Member } from '@/lib/db/schema';

type Viewer = Pick<Member, 'id' | 'isAdmin'>;

/** Admins and whoever hosts that Friday run it: restaurant, guests, totals, payments. */
export function canManageFriday(viewer: Viewer, hostId: number | null): boolean {
  return viewer.isAdmin || viewer.id === hostId;
}

/** Adding members and editing restaurants: admins and the host of the coming Friday. */
export function canManageGroup(viewer: Viewer, currentHostId: number | null): boolean {
  return viewer.isAdmin || viewer.id === currentHostId;
}

export type OrderLockState = { locked: boolean; settled: boolean };

/**
 * Whose order a viewer may change. Before the deadline everyone edits their own and the
 * guests they brought; after it only the people running the Friday; once the money is
 * split nobody, until the split is undone.
 */
export function canEditOrderOf(
  viewer: Viewer,
  target: { id: number; addedById: number | null },
  hostId: number | null,
  state: OrderLockState
): boolean {
  if (state.settled) return false;
  if (canManageFriday(viewer, hostId)) return true;
  if (state.locked) return false;
  return target.id === viewer.id || target.addedById === viewer.id;
}
