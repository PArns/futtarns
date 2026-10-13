import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '@/lib/db/client';
import { createSession } from '@/lib/services/auth';
import { loadFriday, setAttendance } from '@/lib/services/fridays';
import {
  addGuest,
  addGuestWithPhone,
  bootstrapAdmin,
  createMember,
  inviteMember,
  issueLoginToken,
  listGuests,
} from '@/lib/services/members';
import { createTestDb } from '@/test/db';

let db: Db;
let close: () => Promise<void>;
let lines: string[];
const log = (line: string) => lines.push(line);
const ENV = { name: 'Patrick', phone: '+491701111111' };
const NOW = new Date('2026-10-12T10:00:00Z');

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  lines = [];
});

afterEach(async () => {
  await close();
});

describe('the first admin', () => {
  it('is created on an empty database and gets a new link until they log in', async () => {
    await bootstrapAdmin(db, ENV, log, NOW);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^Created admin Patrick\. Login link: .*\/login\/\S+$/);

    await bootstrapAdmin(db, ENV, log, NOW);
    expect(lines).toHaveLength(2);
    expect(lines[1]).toMatch(/^No admin is logged in yet\. Login link for Patrick: /);
    expect(lines[1]!.split('/login/')[1]).not.toBe(lines[0]!.split('/login/')[1]);

    await createSession(db, 1, NOW);
    await bootstrapAdmin(db, ENV, log, NOW);
    expect(lines).toHaveLength(2);
  });

  it('stays quiet without ADMIN_NAME on an empty database', async () => {
    await bootstrapAdmin(db, {}, log, NOW);
    expect(lines).toEqual([]);
  });
});

describe('guests', () => {
  const FRIDAY = '2026-10-16';
  const NEXT = '2026-10-23';

  it('stay on as members outside the Stammtruppe, who say yes on their own', async () => {
    const { member: anna } = await createMember(db, { name: 'Anna', phone: '+491702222222' }, null);
    const { member: tim } = await addGuestWithPhone(
      db,
      FRIDAY,
      { name: 'Tim', phone: '+491705555555' },
      anna.id
    );
    expect(await listGuests(db)).toEqual([{ id: tim.id, name: 'Tim' }]);

    // Next week nobody asked Tim, so he is not on it, until he says yes himself.
    const onNext = async () =>
      (await loadFriday(db, NEXT, NOW)).participants.find((entry) => entry.member.id === tim.id);
    expect(await onNext()).toBeUndefined();
    await setAttendance(db, NEXT, tim.id, 'in');
    expect((await onNext())?.attendance).toEqual({ status: 'in', reason: 'answered' });

    // Or someone invites him again.
    await inviteMember(db, '2026-10-30', tim.id, anna.id);
    const later = await loadFriday(db, '2026-10-30', NOW);
    expect(later.participants.find((entry) => entry.member.id === tim.id)?.addedById).toBe(anna.id);
  });

  it('get a login without joining the Stammtruppe', async () => {
    const { member: anna } = await createMember(db, { name: 'Anna', phone: '+491702222222' }, null);
    const guest = await addGuest(db, FRIDAY, 'Ole', anna.id);
    await issueLoginToken(db, guest.id);
    const [ole] = (await listGuests(db)).filter((entry) => entry.id === guest.id);
    expect(ole?.name).toBe('Ole');
  });
});
