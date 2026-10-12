import path from 'node:path';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import * as schema from '@/lib/db/schema';

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export const MIGRATIONS_FOLDER = path.join(process.cwd(), 'drizzle');

/**
 * Opens the database named by `url`: a Postgres connection string in the Docker stack,
 * otherwise an embedded PGlite (a directory, or `memory://` for tests) so the app runs
 * locally without a database server.
 */
export async function openDb(url: string): Promise<{ db: Db; close: () => Promise<void> }> {
  if (/^postgres(ql)?:\/\//.test(url)) {
    const { default: postgres } = await import('postgres');
    const { drizzle } = await import('drizzle-orm/postgres-js');
    const client = postgres(url, { max: 10 });
    return { db: drizzle(client, { schema }) as unknown as Db, close: () => client.end() };
  }
  const { PGlite } = await import('@electric-sql/pglite');
  const { drizzle } = await import('drizzle-orm/pglite');
  const client = new PGlite(url === 'memory://' ? undefined : url);
  return { db: drizzle(client, { schema }) as unknown as Db, close: () => client.close() };
}

/** Applies the SQL migrations in `drizzle/`; safe to run on every start. */
export async function migrateDb(db: Db, url: string): Promise<void> {
  if (/^postgres(ql)?:\/\//.test(url)) {
    const { migrate } = await import('drizzle-orm/postgres-js/migrator');
    await migrate(db as never, { migrationsFolder: MIGRATIONS_FOLDER });
  } else {
    const { migrate } = await import('drizzle-orm/pglite/migrator');
    await migrate(db as never, { migrationsFolder: MIGRATIONS_FOLDER });
  }
}
