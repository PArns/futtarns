import 'server-only';
import { migrateDb, openDb, type Db } from '@/lib/db/client';

export type { Db } from '@/lib/db/client';

const DEFAULT_URL = '.data/pglite';

export function databaseUrl(): string {
  return process.env.DATABASE_URL || DEFAULT_URL;
}

// Kept on globalThis so dev-server reloads reuse one connection instead of opening more.
const globalForDb = globalThis as unknown as { futtarnsDb?: Promise<Db> };

/** The app's database, migrated on first use. */
export function getDb(): Promise<Db> {
  globalForDb.futtarnsDb ??= (async () => {
    const url = databaseUrl();
    const { db } = await openDb(url);
    await migrateDb(db, url);
    return db;
  })();
  return globalForDb.futtarnsDb;
}
