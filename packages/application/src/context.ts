import {
  type Actor,
  type BankRequest,
  DEFAULT_FRESHNESS,
  DomainError,
  type FreshnessPolicy,
  type Source,
  type StockLine,
  holdsStock,
  observedQuantities,
  outstanding,
  stockLine,
} from '@toadsbank/domain';
import type { Clock, EventType, IdGenerator, Tx, UnitOfWork } from './ports';

export interface Policy {
  freshness: FreshnessPolicy;
  /** How long an open request lives before the worker expires it. */
  requestTtlSeconds: number;
  importSessionSeconds: number;
}

export const DEFAULT_POLICY: Policy = {
  freshness: DEFAULT_FRESHNESS,
  requestTtlSeconds: 14 * 24 * 3600,
  importSessionSeconds: 30 * 60,
};

export interface Deps {
  uow: UnitOfWork;
  clock: Clock;
  ids: IdGenerator;
  policy?: Partial<Policy>;
}

export class Context {
  readonly policy: Policy;

  constructor(readonly deps: Deps) {
    this.policy = { ...DEFAULT_POLICY, ...deps.policy };
  }

  now(): number {
    return this.deps.clock.now();
  }

  id(prefix: string): string {
    return this.deps.ids.next(prefix);
  }

  run<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
    return this.deps.uow.run(work);
  }

  /**
   * TB-DM-06: a mutating call with an idempotency key runs once. A repeat with the same input returns the first
   * result; the same key with different input is a conflict.
   */
  async once<T>(
    tx: Tx,
    actor: Actor,
    key: string,
    operation: string,
    input: unknown,
    work: () => Promise<T>,
  ): Promise<T> {
    if (typeof key !== 'string' || key.length < 1 || key.length > 128) {
      throw new DomainError('bad_request', 'an idempotency key of 1 to 128 characters is required');
    }
    const id = `${actor.memberId}:${key}`;
    await tx.lock([`idempotency:${id}`]);
    const fingerprint = stableStringify({ operation, input });
    const seen = await tx.idempotency.get(id);
    if (seen) {
      if (seen.fingerprint !== fingerprint)
        throw new DomainError('idempotency_conflict', 'this idempotency key was used for a different call');
      return seen.response as T;
    }
    const response = await work();
    await tx.idempotency.put({ id, fingerprint, response: response ?? null, createdAt: this.now() });
    return response;
  }

  async emit(tx: Tx, type: EventType, payload: unknown): Promise<void> {
    const now = this.now();
    await tx.outbox.put({
      id: this.id('evt'),
      type,
      occurredAt: now,
      payload,
      attempts: 0,
      nextAttemptAt: now,
      deliveredAt: null,
      deadAt: null,
      lastError: null,
    });
  }

  async audit(tx: Tx, actor: string, action: string, payload: unknown): Promise<void> {
    await tx.audit.put({ id: this.id('aud'), at: this.now(), actor, action, payload });
  }
}

/** Map over items one at a time: a transaction's queries share one connection and must not overlap. */
export async function inSequence<T, R>(items: readonly T[], map: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (const item of items) out.push(await map(item));
  return out;
}

export function stableStringify(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}

export async function getSource(tx: Tx, id: string): Promise<Source> {
  const source = await tx.sources.get(id);
  if (!source) throw new DomainError('not_found', `no bank ${id}`);
  return source;
}

export async function getRequest(tx: Tx, id: string): Promise<BankRequest> {
  const request = await tx.requests.get(id);
  if (!request) throw new DomainError('not_found', `no request ${id}`);
  return request;
}

export function checkRevision<T extends { revision: number }>(kind: string, entity: T, expected: unknown): void {
  if (!Number.isInteger(expected)) throw new DomainError('bad_request', 'expectedRevision is required');
  if (entity.revision !== expected)
    throw new DomainError('stale_revision', `${kind} has changed since you loaded it`, undefined, entity);
}

/** Stock lines of every item one source holds or owes, from its baselines, deliveries, requests and allocations. */
export async function stockOf(tx: Tx, sourceId: string): Promise<Map<number, StockLine>> {
  // One transaction is one connection, so these run one after another.
  const baselines = await tx.baselines.find({ sourceId });
  const deliveries = await tx.deliveries.find({ sourceId, cleared: false });
  const requests = await tx.requests.find({ sourceId });
  const allocations = await tx.allocations.find({ sourceId });
  const observed = observedQuantities(baselines);
  const pending = new Map<number, number>();
  const reserved = new Map<number, number>();
  const raid = new Map<number, number>();
  const add = (map: Map<number, number>, itemId: number, n: number) => map.set(itemId, (map.get(itemId) ?? 0) + n);
  for (const d of deliveries) add(pending, d.itemId, d.quantity);
  for (const r of requests) if (holdsStock(r) && r.occurrenceId === null) add(reserved, r.itemId, outstanding(r));
  for (const a of allocations) add(raid, a.itemId, a.quantity);
  const items = new Set([...observed.keys(), ...pending.keys(), ...reserved.keys(), ...raid.keys()]);
  const lines = new Map<number, StockLine>();
  for (const itemId of items) {
    lines.set(
      itemId,
      stockLine({
        observed: observed.get(itemId) ?? 0,
        pendingOutgoing: pending.get(itemId) ?? 0,
        raidHeld: raid.get(itemId) ?? 0,
        directReserved: reserved.get(itemId) ?? 0,
      }),
    );
  }
  return lines;
}

export async function itemName(tx: Tx, itemId: number): Promise<string> {
  return (await tx.items.get(String(itemId)))?.name ?? `Item ${itemId}`;
}

export function requireString(value: unknown, field: string, min: number, max: number): string {
  if (typeof value !== 'string' || value.trim().length < min || value.length > max) {
    throw new DomainError('validation_failed', `${field} must be ${min} to ${max} characters`);
  }
  return value.trim();
}

export function requireInt(value: unknown, field: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new DomainError('validation_failed', `${field} must be a whole number from ${min} to ${max}`);
  }
  return value;
}
