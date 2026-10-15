import { describe, expect, it } from 'vitest';
import { canManageFriday, canSetHost, canTakeOver } from '@/lib/permissions';

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

  it('only while the host is away, the Friday open and they are around themselves', () => {
    expect(canTakeOver(anna, { ...away, hostAbsent: false })).toBe(false);
    expect(canTakeOver(anna, { ...away, viewerAbsent: true })).toBe(false);
    expect(canTakeOver(anna, { ...away, locked: true })).toBe(false);
    expect(canTakeOver(anna, { ...away, cancelled: true })).toBe(false);
    expect(canTakeOver({ ...anna, core: false }, away)).toBe(false);
    expect(canTakeOver({ ...anna, id: 1 }, away)).toBe(false);
  });
});
