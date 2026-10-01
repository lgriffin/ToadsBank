import { type Actor, DomainError, approve, canManage, deliver, reject } from '@toadsbank/domain';
import { type Context, checkRevision, getRequest, requireInt } from './context';
import type { Tx } from './ports';
import { managersOf } from './requestItems';
import { type RequestView, requestView } from './views';

/** FulfilRequest: approve, reject and record deliveries (TB-BM-11 to 13, TB-BM-16). Managers and admins only. */
export class FulfilRequest {
  constructor(private readonly ctx: Context) {}

  approve(
    actor: Actor,
    id: string,
    expectedRevision: unknown,
    note: unknown,
    idempotencyKey: string,
  ): Promise<RequestView> {
    return this.decide(actor, id, expectedRevision, note, idempotencyKey, 'approved');
  }

  reject(
    actor: Actor,
    id: string,
    expectedRevision: unknown,
    note: unknown,
    idempotencyKey: string,
  ): Promise<RequestView> {
    return this.decide(actor, id, expectedRevision, note, idempotencyKey, 'rejected');
  }

  /** TB-BM-13: the request, its allocation and the pending outgoing change together, in one transaction. */
  recordDelivery(
    actor: Actor,
    id: string,
    expectedRevision: unknown,
    quantity: unknown,
    idempotencyKey: string,
  ): Promise<RequestView> {
    return this.ctx.run((tx) =>
      this.ctx.once(tx, actor, idempotencyKey, 'request.deliver', { id, expectedRevision, quantity }, async () => {
        const { request, managers } = await this.load(tx, actor, id, expectedRevision);
        const amount = requireInt(quantity, 'quantity', 1, 10_000);
        const now = this.ctx.now();
        const next = deliver(request, now, amount);
        await tx.requests.put(next);
        await tx.deliveries.put({
          id: this.ctx.id('dlv'),
          requestId: request.id,
          sourceId: request.sourceId,
          itemId: request.itemId,
          quantity: amount,
          deliveredAt: now,
          deliveredBy: actor.memberId,
          cleared: false,
          clearedBySnapshot: null,
        });
        if (request.occurrenceId) {
          const [allocation] = await tx.allocations.find({
            occurrenceId: request.occurrenceId,
            sourceId: request.sourceId,
            itemId: request.itemId,
          });
          if (allocation)
            await tx.allocations.put({ ...allocation, quantity: Math.max(0, allocation.quantity - amount) });
        }
        const view = requestView(next, managers);
        await this.ctx.emit(tx, 'request.updated', {
          request: view,
          change: next.status === 'fulfilled' ? 'fulfilled' : 'delivered',
          quantity: amount,
        });
        return view;
      }),
    );
  }

  private decide(
    actor: Actor,
    id: string,
    expectedRevision: unknown,
    note: unknown,
    key: string,
    change: 'approved' | 'rejected',
  ) {
    return this.ctx.run((tx) =>
      this.ctx.once(tx, actor, key, `request.${change}`, { id, expectedRevision, note }, async () => {
        const { request, managers } = await this.load(tx, actor, id, expectedRevision);
        if (note !== undefined && note !== null && (typeof note !== 'string' || note.length > 200)) {
          throw new DomainError('validation_failed', 'note must be at most 200 characters');
        }
        const text = typeof note === 'string' && note.trim() ? note.trim() : null;
        const now = this.ctx.now();
        const next = change === 'approved' ? approve(request, now, text) : reject(request, now, text);
        await tx.requests.put(next);
        const view = requestView(next, managers);
        await this.ctx.emit(tx, 'request.updated', { request: view, change });
        return view;
      }),
    );
  }

  private async load(tx: Tx, actor: Actor, id: string, expectedRevision: unknown) {
    const request = await getRequest(tx, id);
    await tx.lock([`source:${request.sourceId}`]);
    const managers = await managersOf(tx, request);
    if (!canManage({ managers }, actor)) throw new DomainError('forbidden', 'only this bank’s managers can do that');
    // TB-BM-16: a button from an older message carries an older revision and is refused with the current state.
    checkRevision('the request', request, expectedRevision);
    return { request, managers };
  }
}
