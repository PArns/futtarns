import type { Member } from '@/lib/db/schema';

type Viewer = Pick<Member, 'id' | 'isAdmin'>;

/** Admins and whoever hosts that Friday run it: restaurant, guests, totals, payments. */
export function canManageFriday(viewer: Viewer, hostId: number | null): boolean {
  return viewer.isAdmin || viewer.id === hostId;
}

/**
 * Who may hand a Friday to another host: whoever runs it, and members with the
 * „Vertretungen“ role, who may do that for every Friday without running it.
 */
export function canSetHost(
  viewer: Viewer & Pick<Member, 'assignsHosts'>,
  hostId: number | null
): boolean {
  return canManageFriday(viewer, hostId) || viewer.assignsHosts;
}

/**
 * Whether someone may take a Friday over themselves because its host is away that day or
 * it has none: any active member of the Stammtruppe who is not the host and not away too,
 * while the Friday is still open.
 */
export function canTakeOver(
  viewer: Pick<Member, 'id' | 'kind' | 'active' | 'core'>,
  friday: {
    hostId: number | null;
    hostAbsent: boolean;
    viewerAbsent: boolean;
    locked: boolean;
    cancelled: boolean;
  }
): boolean {
  return (
    (friday.hostAbsent || friday.hostId === null) &&
    !friday.viewerAbsent &&
    !friday.locked &&
    !friday.cancelled &&
    viewer.id !== friday.hostId &&
    viewer.kind === 'member' &&
    viewer.active &&
    viewer.core
  );
}

/** Only admins put a Friday at nobody's place, so the group sorts out who hosts it. */
export function canClearHost(viewer: Viewer): boolean {
  return viewer.isAdmin;
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

/**
 * Who may say someone comes later: whoever may change their order, also after the deadline,
 * because the host may still order their dish later. Not once the Friday is settled.
 */
export function canSetArrival(
  viewer: Viewer,
  target: { id: number; addedById: number | null },
  hostId: number | null,
  state: OrderLockState
): boolean {
  return canEditOrderOf(viewer, target, hostId, { ...state, locked: false });
}
