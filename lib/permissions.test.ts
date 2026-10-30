import { describe, expect, it } from 'vitest';
import {
  canClearHost,
  canManageFriday,
  canSetArrival,
  canSetHost,
  canTakeOver,
} from '@/lib/permissions';

const member = { id: 2, isAdmin: false, assignsHosts: false };
const hostRole = { id: 3, isAdmin: false, assignsHosts: true };
const admin = { id: 4, isAdmin: true, assignsHosts: false };

describe('canSetHost', () => {
  it('lets the Friday’s host, admins and the Gastgeber role hand a Friday on', () => {
    expect(canSetHost(member, 2)).toBe(true);
    expect(canSetHost(admin, 1)).toBe(true);
    expect(canSetHost(hostRole, 1)).toBe(true);
    expect(canSetHost(hostRole, null)).toBe(true);
    expect(canSetHost(member, 1)).toBe(false);
  });

  it('gives the Vertretungen role nothing else of the Friday', () => {
    expect(canManageFriday(hostRole, 1)).toBe(false);
  });

  it('leaves putting a Friday at nobody’s place to admins', () => {
    expect(canClearHost(admin)).toBe(true);
    expect(canClearHost(hostRole)).toBe(false);
    expect(canClearHost(member)).toBe(false);
  });
});

describe('canTakeOver', () => {
  const anna = { id: 2, kind: 'member' as const, active: true, core: true };
  const away = {
    hostId: 1,
    hostAbsent: true,
    viewerAbsent: false,
    locked: false,
    cancelled: false,
  };

  it('lets anyone of the Stammtruppe step in for a host who is away', () => {
    expect(canTakeOver(anna, away)).toBe(true);
  });

  it('lets them take over a Friday that has no host at all', () => {
    expect(canTakeOver(anna, { ...away, hostId: null, hostAbsent: false })).toBe(true);
    expect(canTakeOver(anna, { ...away, hostId: null, hostAbsent: false, locked: true })).toBe(
      false
    );
  });

  it('only while the host is away, the Friday open and they are around themselves', () => {
    expect(canTakeOver(anna, { ...away, hostAbsent: false })).toBe(false);
    expect(canTakeOver(anna, { ...away, viewerAbsent: true })).toBe(false);
    expect(canTakeOver(anna, { ...away, locked: true })).toBe(false);
    expect(canTakeOver(anna, { ...away, cancelled: true })).toBe(false);
    expect(canTakeOver({ ...anna, core: false }, away)).toBe(false);
    expect(canTakeOver({ ...anna, id: 1 }, away)).toBe(false);
  });
});

describe('canSetArrival', () => {
  const anna = { id: 2, isAdmin: false, assignsHosts: false };
  const self = { id: 2, addedById: null };

  it('lets people say they come later after the deadline too, but not once settled', () => {
    expect(canSetArrival(anna, self, 1, { locked: true, settled: false })).toBe(true);
    expect(canSetArrival(anna, self, 1, { locked: true, settled: true })).toBe(false);
    expect(
      canSetArrival(anna, { id: 3, addedById: null }, 1, { locked: false, settled: false })
    ).toBe(false);
  });
});
