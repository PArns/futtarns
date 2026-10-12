import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '@/lib/db/client';
import {
  createSession,
  findMemberBySession,
  requestLoginCode,
  verifyLoginCode,
} from '@/lib/services/auth';
import { createMember } from '@/lib/services/members';
import { createTestDb } from '@/test/db';

let db: Db;
let close: () => Promise<void>;
const PHONE = '+491701234567';
const NOW = new Date('2026-10-12T10:00:00Z');

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  await createMember(db, { name: 'Anna', phone: PHONE }, null);
});

afterEach(async () => {
  await close();
});

describe('phone login', () => {
  it('logs in with the code that was sent', async () => {
    const { code, member } = await requestLoginCode(db, PHONE, NOW);
    expect(code).toMatch(/^\d{6}$/);
    expect((await verifyLoginCode(db, PHONE, code, NOW)).id).toBe(member.id);
    await expect(verifyLoginCode(db, PHONE, code, NOW)).rejects.toThrow('abgelaufen');
  });

  it('refuses unknown numbers and quick resends', async () => {
    await expect(requestLoginCode(db, '+4915100000000', NOW)).rejects.toThrow('kennen wir nicht');
    await requestLoginCode(db, PHONE, NOW);
    await expect(requestLoginCode(db, PHONE, new Date(NOW.getTime() + 10_000))).rejects.toThrow(
      'Warte'
    );
  });

  it('gives up on a code after five wrong guesses', async () => {
    const { code } = await requestLoginCode(db, PHONE, NOW);
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++)
      await expect(verifyLoginCode(db, PHONE, wrong, NOW)).rejects.toThrow('stimmt nicht');
    await expect(verifyLoginCode(db, PHONE, code, NOW)).rejects.toThrow('abgelaufen');
  });

  it('expires codes after ten minutes', async () => {
    const { code } = await requestLoginCode(db, PHONE, NOW);
    await expect(
      verifyLoginCode(db, PHONE, code, new Date(NOW.getTime() + 11 * 60_000))
    ).rejects.toThrow('abgelaufen');
  });

  it('keeps a session until it expires', async () => {
    const { member } = await requestLoginCode(db, PHONE, NOW);
    const token = await createSession(db, member.id, NOW);
    expect((await findMemberBySession(db, token, NOW))?.id).toBe(member.id);
    expect(
      await findMemberBySession(db, token, new Date(NOW.getTime() + 181 * 86_400_000))
    ).toBeNull();
    expect(await findMemberBySession(db, 'nope', NOW)).toBeNull();
  });
});
