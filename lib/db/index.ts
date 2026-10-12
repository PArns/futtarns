import { migrateDb, openDb, type Db } from '@/lib/db/client';
import { normalizePhone } from '@/lib/phone';
import { bootstrapAdmin } from '@/lib/services/members';

export type { Db } from '@/lib/db/client';

const DEFAULT_URL = '.data/pglite';

export function databaseUrl(): string {
  return process.env.DATABASE_URL || DEFAULT_URL;
}

// Kept on globalThis so dev-server reloads reuse one connection instead of opening more.
const globalForDb = globalThis as unknown as { futtarnsDb?: Promise<Db> };

/**
 * The app's database, migrated on first use. A failed start (the database container is
 * not up yet) is forgotten, so the next request tries again instead of failing forever.
 */
export function getDb(): Promise<Db> {
  globalForDb.futtarnsDb ??= (async () => {
    const url = databaseUrl();
    const { db } = await openDb(url);
    await migrateDb(db, url);
    await bootstrapAdmin(
      db,
      {
        name: process.env.ADMIN_NAME,
        phone: process.env.ADMIN_PHONE ? normalizePhone(process.env.ADMIN_PHONE) : null,
      },
      (line) => console.log(line)
    );
    return db;
  })().catch((error: unknown) => {
    globalForDb.futtarnsDb = undefined;
    throw error;
  });
  return globalForDb.futtarnsDb;
}
