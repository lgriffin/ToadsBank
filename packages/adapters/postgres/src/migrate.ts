import type pg from 'pg';
import { MIGRATIONS, type Migration } from './migrations/index';

/** Apply pending migrations in order, each in its own transaction, under an advisory lock so replicas can race. */
export async function migrate(pool: pg.Pool, migrations: Migration[] = MIGRATIONS): Promise<string[]> {
  const client = await pool.connect();
  const applied: string[] = [];
  try {
    await client.query('SELECT pg_advisory_lock(727274)');
    await client.query(
      'CREATE TABLE IF NOT EXISTS schema_migrations (id text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
    );
    const done = new Set(
      (await client.query<{ id: string }>('SELECT id FROM schema_migrations')).rows.map((r) => r.id),
    );
    for (const migration of migrations) {
      if (done.has(migration.id)) continue;
      await client.query('BEGIN');
      try {
        await client.query(migration.sql);
        await client.query('INSERT INTO schema_migrations (id) VALUES ($1)', [migration.id]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
      applied.push(migration.id);
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock(727274)').catch(() => undefined);
    client.release();
  }
  return applied;
}

export async function databaseIsReady(pool: pg.Pool): Promise<boolean> {
  try {
    await pool.query('SELECT 1 FROM schema_migrations LIMIT 1');
    return true;
  } catch {
    return false;
  }
}
