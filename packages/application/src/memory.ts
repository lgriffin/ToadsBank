import type { Clock, Collection, IdGenerator, Match, Tx, UnitOfWork } from './ports';

/** In-memory fakes for the driven ports, used by unit and BDD tests and the dev stack's seed. */

const COLLECTIONS = [
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

type State = Record<(typeof COLLECTIONS)[number], Map<string, unknown>>;

class MemoryCollection<T extends { id: string }> implements Collection<T> {
  constructor(private readonly docs: () => Map<string, unknown>) {}

  async get(id: string): Promise<T | undefined> {
    const doc = this.docs().get(id);
    return doc === undefined ? undefined : (structuredClone(doc) as T);
  }

  async put(doc: T): Promise<void> {
    this.docs().set(doc.id, structuredClone(doc));
  }

  async delete(id: string): Promise<void> {
    this.docs().delete(id);
  }

  async find(match: Match<T> = {}): Promise<T[]> {
    const entries = Object.entries(match);
    return [...this.docs().values()]
      .filter((doc) => entries.every(([key, value]) => (doc as Record<string, unknown>)[key] === value))
      .map((doc) => structuredClone(doc) as T);
  }
}

/**
 * One transaction at a time, rolled back by restoring a copy of the state when the work throws.
 *
 * Transactions never overlap here, so `beforeLock` lets a test stage the interleaving a real database allows: another
 * transaction that committed while this one waited for a lock.
 */
export class MemoryUnitOfWork implements UnitOfWork {
  private state: State = Object.fromEntries(COLLECTIONS.map((name) => [name, new Map()])) as State;
  private queue: Promise<unknown> = Promise.resolve();
  private rollback: State | undefined;
  private hooks: Array<{ key: string; work: (tx: Tx) => Promise<void> }> = [];
  readonly tx: Tx;

  constructor() {
    const tx: Partial<Tx> = { lock: (keys) => this.lock(keys) };
    for (const name of COLLECTIONS) {
      (tx as Record<string, unknown>)[name] = new MemoryCollection(() => this.state[name]);
    }
    this.tx = tx as Tx;
  }

  /**
   * Test seam: the next time a transaction locks `key`, `work` runs first and stays committed even if that transaction
   * rolls back, as if another transaction had committed it while this one waited for the lock.
   */
  beforeLock(key: string, work: (tx: Tx) => Promise<void>): void {
    this.hooks.push({ key, work });
  }

  private async lock(keys: string[]): Promise<void> {
    for (const key of [...new Set(keys)].sort()) {
      const index = this.hooks.findIndex((h) => h.key === key);
      if (index < 0) continue;
      const [hook] = this.hooks.splice(index, 1);
      await hook?.work(this.tx);
      this.rollback = structuredClone(this.state);
    }
  }

  run<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
    const result = this.queue.then(async () => {
      this.rollback = structuredClone(this.state);
      try {
        return await work(this.tx);
      } catch (error) {
        this.state = this.rollback as State;
        throw error;
      } finally {
        this.rollback = undefined;
      }
    });
    this.queue = result.catch(() => undefined);
    return result;
  }
}

export class ManualClock implements Clock {
  constructor(public current = 1_790_800_000) {}

  now(): number {
    return this.current;
  }

  advance(seconds: number): void {
    this.current += seconds;
  }
}

export class SequentialIds implements IdGenerator {
  private counters = new Map<string, number>();

  next(prefix: string): string {
    const n = (this.counters.get(prefix) ?? 0) + 1;
    this.counters.set(prefix, n);
    return `${prefix}_${n}`;
  }
}
