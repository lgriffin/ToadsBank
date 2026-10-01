import {
  type Actor,
  type BankRequest,
  DomainError,
  type RequestStatus,
  blocksReservations,
  canManage,
  canSee,
  cancel,
  holdsStock,
  isOfficer,
  outstanding,
} from '@toadsbank/domain';
import {
  type Context,
  checkRevision,
  getRequest,
  getSource,
  itemName,
  requireInt,
  requireString,
  stockOf,
} from './context';
import type { Match, Tx } from './ports';
import { activeOccurrence, raidAvailable, raidManagers } from './raidStock';
import { type RequestView, requestView } from './views';

export interface RequestInput {
  sourceId?: unknown;
  itemId?: unknown;
  quantity?: unknown;
  character?: unknown;
  note?: unknown;
  occurrenceId?: unknown;
  waitlist?: unknown;
}

export type RequestScope = 'mine' | 'queue' | 'all';

/** RequestItems: create, cancel, waitlist and list (TB-GM-05 to 09). The site and Discord both come through here. */
export class RequestItems {
  constructor(private readonly ctx: Context) {}

  create(actor: Actor, input: RequestInput, idempotencyKey: string): Promise<RequestView> {
    return this.ctx.run((tx) =>
      this.ctx.once(tx, actor, idempotencyKey, 'request.create', input, async () => {
        const sourceId = requireString(input.sourceId, 'sourceId', 1, 64);
        const itemId = requireInt(input.itemId, 'itemId', 1, 2_147_483_647);
        const quantity = requireInt(input.quantity, 'quantity', 1, 10_000);
        const character = requireString(input.character, 'character', 1, 24);
        const note = input.note === undefined ? '' : requireString(input.note, 'note', 0, 200);
        const occurrenceId =
          input.occurrenceId == null ? null : requireString(input.occurrenceId, 'occurrenceId', 1, 64);
        const waitlist = input.waitlist === true;
        // TB-GM-05: the stock check and the hold happen under the source's lock, so two requests never share stock.
        // A raid request also takes the raid's lock, before the bank's as every caller does, so it cannot slip in
        // beside the raid's expiry.
        await tx.lock(occurrenceId ? [`occurrence:${occurrenceId}`, `source:${sourceId}`] : [`source:${sourceId}`]);
        const source = await getSource(tx, sourceId);
        if (!canSee(source, actor)) throw new DomainError('not_found', `no bank ${sourceId}`);
        const now = this.ctx.now();
        // Waitlisted or not, a raid request must name a raid night that exists and has not expired.
        if (occurrenceId) await activeOccurrence(tx, occurrenceId);
        if (!waitlist) {
          if (blocksReservations(source, now, this.ctx.policy.freshness)) {
            throw new DomainError('source_stale', `${source.name} has not been scanned recently enough to hold stock`);
          }
          const available = occurrenceId
            ? await raidAvailable(tx, occurrenceId, sourceId, itemId)
            : ((await stockOf(tx, sourceId)).get(itemId)?.available ?? 0);
          if (available < quantity) {
            // TB-GM-06: offer a waitlisted request that holds nothing.
            throw new DomainError('insufficient_stock', `only ${available} available`, {
              available,
              canWaitlist: true,
            });
          }
        }
        const request: BankRequest = {
          id: this.ctx.id('req'),
          revision: 1,
          status: waitlist ? 'waitlisted' : 'reserved',
          memberId: actor.memberId,
          memberName: actor.name,
          character,
          sourceId,
          itemId,
          itemName: await itemName(tx, itemId),
          quantity,
          delivered: 0,
          occurrenceId,
          note,
          managerNote: null,
          createdAt: now,
          updatedAt: now,
          expiresAt: now + this.ctx.policy.requestTtlSeconds,
        };
        await tx.requests.put(request);
        const managers = await managersOf(tx, request);
        const view = requestView(request, managers);
        await this.ctx.emit(tx, 'request.created', { request: view });
        // TB-BM-11: the managers hear about it by DM; the site lists it in their queue.
        if (!waitlist) await this.ctx.emit(tx, 'request.assigned', { request: view, managers });
        return view;
      }),
    );
  }

  /** TB-GM-07: release only the outstanding quantity; recorded deliveries stay. */
  cancel(actor: Actor, id: string, expectedRevision: unknown, idempotencyKey: string): Promise<RequestView> {
    return this.ctx.run((tx) =>
      this.ctx.once(tx, actor, idempotencyKey, 'request.cancel', { id, expectedRevision }, async () => {
        await lockRequestSource(tx, id);
        // Read the request again under the lock, so the revision check and the write see what is committed now.
        const request = await getRequest(tx, id);
        const managers = await managersOf(tx, request);
        if (request.memberId !== actor.memberId && !canManage({ managers }, actor)) {
          throw new DomainError('forbidden', 'only the requester or a manager can cancel this request');
        }
        checkRevision('the request', request, expectedRevision);
        const next = cancel(request, this.ctx.now());
        await releaseExpiredRaidHold(tx, request);
        await tx.requests.put(next);
        const view = requestView(next, managers);
        await this.ctx.emit(tx, 'request.updated', { request: view, change: 'cancelled' });
        return view;
      }),
    );
  }

  list(actor: Actor, scope: RequestScope = 'mine', status?: string): Promise<RequestView[]> {
    return this.ctx.run(async (tx) => {
      const match: Match<BankRequest> = {
        ...(scope === 'mine' ? { memberId: actor.memberId } : {}),
        ...(status ? { status: status as RequestStatus } : {}),
      };
      const all = await tx.requests.find(match);
      const views: RequestView[] = [];
      for (const request of all) {
        if (status && request.status !== status) continue;
        const managers = await managersOf(tx, request);
        if (scope === 'queue' && !canManage({ managers }, actor)) continue;
        if (scope === 'all' && !isOfficer(actor))
          throw new DomainError('forbidden', 'only officers can list every request');
        views.push(requestView(request, managers));
      }
      return views.sort((a, b) => a.createdAt - b.createdAt);
    });
  }
}

/**
 * Take the lock of the bank a request draws on. A request never changes bank, so its source id can be read before
 * the lock; everything else about it must be read again after.
 */
export async function lockRequestSource(tx: Tx, requestId: string): Promise<void> {
  const { sourceId } = await getRequest(tx, requestId);
  await tx.lock([`source:${sourceId}`]);
}

/**
 * Who acts on a request: the bank's managers, plus the raid's managers for a raid request on a bank every member may
 * see. A bank limited to officers keeps its requests to its own managers: being a raid's manager grants no sight of a
 * private bank (TB-GM-04).
 */
export async function managersOf(tx: Tx, request: Pick<BankRequest, 'sourceId' | 'occurrenceId'>): Promise<string[]> {
  const source = await getSource(tx, request.sourceId);
  const raid =
    request.occurrenceId && source.audience === 'members' ? await raidManagers(tx, request.occurrenceId) : [];
  return [...new Set([...source.managers, ...raid])];
}

/** Once a raid has expired its allocation only covers open raid requests, so ending one releases its share. */
export async function releaseExpiredRaidHold(tx: Tx, request: BankRequest): Promise<void> {
  if (!request.occurrenceId || !holdsStock(request)) return;
  const occurrence = await tx.occurrences.get(request.occurrenceId);
  if (occurrence?.status !== 'expired') return;
  const [allocation] = await tx.allocations.find({
    occurrenceId: request.occurrenceId,
    sourceId: request.sourceId,
    itemId: request.itemId,
  });
  if (allocation)
    await tx.allocations.put({ ...allocation, quantity: Math.max(0, allocation.quantity - outstanding(request)) });
}
