import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '@/lib/db/client';
import { createSession } from '@/lib/services/auth';
import { bootstrapAdmin } from '@/lib/services/members';
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
