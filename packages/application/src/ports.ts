import type {
  Allocation,
  BankRequest,
  Part,
  RaidOccurrence,
  RaidProfile,
  Source,
  TabBaseline,
} from '@toadsbank/domain';

/** Driven ports. Production adapters live in packages/adapters; in-memory fakes in ./memory. */

export interface Clock {
  /** Epoch seconds. */
  now(): number;
}

export interface IdGenerator {
  next(prefix: string): string;
}

export type Match<T> = { [K in keyof T]?: T[K] extends string | number | boolean | null ? T[K] : never };

/** A keyed store of plain JSON documents. `find` returns documents whose fields equal every field in `match`. */
export interface Collection<T extends { id: string }> {
  get(id: string): Promise<T | undefined>;
  put(doc: T): Promise<void>;
  delete(id: string): Promise<void>;
  find(match?: Match<T>): Promise<T[]>;
}

export interface ImportSession {
  id: string;
  openedBy: string;
  openedAt: number;
  expiresAt: number;
  exportId: string | null;
  parts: Part[];
}

export interface Receipt {
  snapshotId: string;
  sourceId: string;
  acceptedAt: number;
  tabsUpdated: number[];
  tabsKeptAsHistory: number[];
  tabsNotRead: number[];
  duplicate: boolean;
}

export interface StoredSnapshot {
  id: string;
  sourceId: string;
  canonical: string;
  capturedAt: number;
  acceptedAt: number;
  acceptedBy: string;
  receipt: Receipt;
}

export interface BaselineDoc extends TabBaseline {
  id: string;
}

export interface ItemDoc {
  id: string;
  itemId: number;
  name: string;
}

/** A recorded hand-out. Until a later covering observation clears it, its quantity is pending outgoing (TB-BM-14). */
export interface Delivery {
  id: string;
  requestId: string;
  sourceId: string;
  itemId: number;
  quantity: number;
  deliveredAt: number;
  deliveredBy: string;
  cleared: boolean;
  clearedBySnapshot: string | null;
}

export type ReconciliationLabel = 'consistent_with_reported_movement' | 'unexplained_decrease';

/** A quantity drop seen between two observations, labelled but never attributed to a member (TB-BM-15). */
export interface Reconciliation {
  id: string;
  sourceId: string;
  itemId: number;
  snapshotId: string;
  before: number;
  after: number;
  reported: number;
  label: ReconciliationLabel;
  resolved: boolean;
  resolvedBy: string | null;
  resolution: string | null;
  createdAt: number;
}

export interface ProfileDoc extends RaidProfile {}
export interface OccurrenceDoc extends RaidOccurrence {}
export interface AllocationDoc extends Allocation {}

export type EventType =
  | 'snapshot.accepted'
  | 'request.created'
  | 'request.assigned'
  | 'request.updated'
  | 'raid.expired';

export interface OutboxEvent {
  id: string;
  type: EventType;
  occurredAt: number;
  payload: unknown;
  attempts: number;
  nextAttemptAt: number;
  deliveredAt: number | null;
  deadAt: number | null;
  lastError: string | null;
}

export interface IdempotencyRecord {
  id: string;
  fingerprint: string;
  response: unknown;
  createdAt: number;
}

export interface AuditEvent {
  id: string;
  at: number;
  actor: string;
  action: string;
  payload: unknown;
}

/** Everything one transaction can touch. */
export interface Tx {
  /** Take exclusive locks for the rest of the transaction, always in sorted order so two transactions never deadlock. */
  lock(keys: string[]): Promise<void>;
  sources: Collection<Source>;
  importSessions: Collection<ImportSession>;
  snapshots: Collection<StoredSnapshot>;
  baselines: Collection<BaselineDoc>;
  items: Collection<ItemDoc>;
  requests: Collection<BankRequest>;
  deliveries: Collection<Delivery>;
  reconciliations: Collection<Reconciliation>;
  raidProfiles: Collection<ProfileDoc>;
  occurrences: Collection<OccurrenceDoc>;
  allocations: Collection<AllocationDoc>;
  outbox: Collection<OutboxEvent>;
  idempotency: Collection<IdempotencyRecord>;
  audit: Collection<AuditEvent>;
}

/** Runs `work` in one transaction: all of it commits, or none of it does. */
export interface UnitOfWork {
  run<T>(work: (tx: Tx) => Promise<T>): Promise<T>;
}

/** Where outbox events go: the Toads hub, which turns them into Discord DMs, posts and dashboard edits. */
export interface EventSink {
  deliver(event: Pick<OutboxEvent, 'id' | 'type' | 'occurredAt' | 'payload'>): Promise<void>;
}
