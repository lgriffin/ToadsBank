export type DomainErrorCode =
  | 'bad_request'
  | 'validation_failed'
  | 'forbidden'
  | 'not_found'
  | 'stale_revision'
  | 'idempotency_conflict'
  | 'insufficient_stock'
  | 'snapshot_conflict'
  | 'invalid_transition'
  | 'over_allocated'
  | 'transport_error'
  | 'invalid_snapshot'
  | 'unknown_source'
  | 'import_expired'
  | 'incomplete'
  | 'source_stale';

/** A rule said no. Adapters map the code to their own vocabulary (HTTP status, Discord reply). */
export class DomainError extends Error {
  constructor(
    readonly code: DomainErrorCode,
    message: string,
    readonly details?: unknown,
    readonly current?: unknown,
  ) {
    super(message);
  }
}

export function staleRevision(kind: string, current: { revision: number }): DomainError {
  return new DomainError('stale_revision', `${kind} has changed since you loaded it`, undefined, current);
}
