import { describe, expect, it } from 'vitest';
import { canManageFriday, canSetHost } from '@/lib/permissions';

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

  it('gives the Gastgeber role nothing else of the Friday', () => {
    expect(canManageFriday(hostRole, 1)).toBe(false);
  });
});
