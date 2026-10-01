import { DomainError } from './errors';

export type RequestStatus = 'reserved' | 'approved' | 'waitlisted' | 'fulfilled' | 'cancelled' | 'rejected' | 'expired';
export type RequestChange = 'approved' | 'rejected' | 'cancelled' | 'delivered' | 'fulfilled' | 'expired';

export interface BankRequest {
  id: string;
  revision: number;
  status: RequestStatus;
  memberId: string;
  memberName: string;
  character: string;
  sourceId: string;
  itemId: number;
  itemName: string;
  quantity: number;
  delivered: number;
  occurrenceId: string | null;
  note: string;
  managerNote: string | null;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
}

/** Requests that hold stock: their outstanding quantity is reserved. */
export const HOLDING: readonly RequestStatus[] = ['reserved', 'approved'];
export const OPEN: readonly RequestStatus[] = ['reserved', 'approved', 'waitlisted'];

export const outstanding = (request: Pick<BankRequest, 'quantity' | 'delivered'>) =>
  request.quantity - request.delivered;
export const holdsStock = (request: Pick<BankRequest, 'status'>) => HOLDING.includes(request.status);
export const isOpen = (request: Pick<BankRequest, 'status'>) => OPEN.includes(request.status);

function moved(request: BankRequest, now: number, patch: Partial<BankRequest>): BankRequest {
  return { ...request, ...patch, revision: request.revision + 1, updatedAt: now };
}

function requireOpen(request: BankRequest, action: string): void {
  if (!isOpen(request))
    throw new DomainError('invalid_transition', `a ${request.status} request cannot be ${action}`, undefined, request);
}

export function approve(request: BankRequest, now: number, note: string | null): BankRequest {
  if (request.status !== 'reserved') {
    throw new DomainError('invalid_transition', `a ${request.status} request cannot be approved`, undefined, request);
  }
  return moved(request, now, { status: 'approved', managerNote: note });
}

export function reject(request: BankRequest, now: number, note: string | null): BankRequest {
  requireOpen(request, 'rejected');
  return moved(request, now, { status: 'rejected', managerNote: note });
}

/** TB-GM-07: cancelling releases only what is outstanding; recorded deliveries stay. */
export function cancel(request: BankRequest, now: number): BankRequest {
  requireOpen(request, 'cancelled');
  return moved(request, now, { status: 'cancelled' });
}

export function expire(request: BankRequest, now: number): BankRequest {
  requireOpen(request, 'expired');
  return moved(request, now, { status: 'expired' });
}

export function deliver(request: BankRequest, now: number, quantity: number): BankRequest {
  if (!holdsStock(request)) {
    throw new DomainError(
      'invalid_transition',
      `a ${request.status} request cannot take deliveries`,
      undefined,
      request,
    );
  }
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > outstanding(request)) {
    throw new DomainError('validation_failed', `delivery must be 1 to ${outstanding(request)}`);
  }
  const delivered = request.delivered + quantity;
  return moved(request, now, { delivered, status: delivered === request.quantity ? 'fulfilled' : request.status });
}
