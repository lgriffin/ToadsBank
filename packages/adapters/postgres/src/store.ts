import type { Collection, Match, Tx, UnitOfWork } from '@toadsbank/application';
import type pg from 'pg';

const KINDS = [
  'sources',
  'importSessions',
  'snapshots',
  'baselines',
  'items',
  'requests',
  'deliveries',
  'reconciliations',
  'raidProfiles',
  'occurrences',
  'allocations',
  'outbox',
  'idempotency',
  'audit',
] as const satisfies ReadonlyArray<Exclude<keyof Tx, 'lock'>>;

/** Postgres error codes worth one more try: serialization failure and deadlock. */
const RETRYABLE = new Set(['40001', '40P01']);

class PgCollection<T extends { id: string }> implements Collection<T> {
  constructor(
    private readonly client: pg.PoolClient,
    private readonly kind: string,
  ) {}

  async get(id: string): Promise<T | undefined> {
    const result = await this.client.query<{ data: T }>('SELECT data FROM documents WHERE kind = $1 AND id = $2', [
      this.kind,
      id,
    ]);
    return result.rows[0]?.data;
  }

  async put(doc: T): Promise<void> {
    await this.client.query(
      `INSERT INTO documents (kind, id, data) VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (kind, id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
      [this.kind, doc.id, JSON.stringify(doc)],
    );
  }

  async delete(id: string): Promise<void> {
    await this.client.query('DELETE FROM documents WHERE kind = $1 AND id = $2', [this.kind, id]);
  }

  async find(match: Match<T> = {}): Promise<T[]> {
    const result = await this.client.query<{ data: T }>(
      'SELECT data FROM documents WHERE kind = $1 AND data @> $2::jsonb ORDER BY id',
      [this.kind, JSON.stringify(match)],
    );
    return result.rows.map((r) => r.data);
  }
}

/** UnitOfWork as a Postgres transaction; `lock` takes transaction-scoped advisory locks in sorted order. */
export class PgUnitOfWork implements UnitOfWork {
  constructor(
    private readonly pool: pg.Pool,
    private readonly attempts = 3,
  ) {}

  async run<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      const client = await this.pool.connect();
      try {
        await client.query('BEGIN');
        const result = await work(this.tx(client));
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        const code = (error as { code?: string }).code;
        if (attempt >= this.attempts || !code || !RETRYABLE.has(code)) throw error;
      } finally {
        client.release();
      }
    }
  }

  private tx(client: pg.PoolClient): Tx {
    const tx: Partial<Tx> = {
      lock: async (keys: string[]) => {
        for (const key of [...new Set(keys)].sort()) {
          await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [key]);
        }
      },
    };
    for (const kind of KINDS) (tx as Record<string, unknown>)[kind] = new PgCollection(client, kind);
    return tx as Tx;
  }
}
