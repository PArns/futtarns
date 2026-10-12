import { migrateDb, openDb, type Db } from '@/lib/db/client';

/** A fresh in-memory database with all migrations applied. */
export async function createTestDb(): Promise<{ db: Db; close: () => Promise<void> }> {
  const opened = await openDb('memory://');
  await migrateDb(opened.db, 'memory://');
  return opened;
}
