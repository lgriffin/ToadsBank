import { OPEN, expire, holdsStock, isOpen, outstanding } from '@toadsbank/domain';
import { type Context, getRequest } from './context';
import type { EventSink, OutboxEvent, Tx } from './ports';
import { lockRequestSource, managersOf, releaseExpiredRaidHold } from './requestItems';
import { requestView } from './views';

const MAX_DELIVERY_SECONDS = 24 * 3600;

/** Worker jobs: expire raids and requests, and deliver the outbox to the hub. */
export class Housekeeping {
  constructor(private readonly ctx: Context) {}

  /**
   * TB-RL-06: an expired raid returns its unused commitments to general stock and leaves an audit event. The scan
   * only finds candidates; each raid expires in its own transaction, read again under the lock that allocations and
   * raid requests take too, so nothing commits against it in between.
   */
  async expireRaids(): Promise<string[]> {
    const now = this.ctx.now();
    const candidates = await this.ctx.run(async (tx) =>
      (await tx.occurrences.find({ status: 'active' })).filter((o) => o.expiresAt <= now).map((o) => o.id),
    );
    const expired: string[] = [];
    for (const id of candidates) if (await this.ctx.run((tx) => this.expireRaid(tx, id, now))) expired.push(id);
    return expired;
  }

  private async expireRaid(tx: Tx, id: string, now: number): Promise<boolean> {
    // The raid's lock first, then its banks' in one sorted call: the order allocate and raid requests use.
    await tx.lock([`occurrence:${id}`]);
    const occurrence = await tx.occurrences.get(id);
    if (occurrence?.status !== 'active' || occurrence.expiresAt > now) return false;
    const allocations = await tx.allocations.find({ occurrenceId: id });
    await tx.lock(allocations.map((a) => `source:${a.sourceId}`));
    const released: Array<{ sourceId: string; itemId: number; quantity: number }> = [];
    for (const allocation of allocations) {
      const requests = await tx.requests.find({
        occurrenceId: id,
        sourceId: allocation.sourceId,
        itemId: allocation.itemId,
      });
      const held = requests.filter(holdsStock).reduce((n, r) => n + outstanding(r), 0);
      const unused = Math.max(0, allocation.quantity - held);
      if (unused > 0) released.push({ sourceId: allocation.sourceId, itemId: allocation.itemId, quantity: unused });
      await tx.allocations.put({ ...allocation, quantity: allocation.quantity - unused });
    }
    await tx.occurrences.put({ ...occurrence, status: 'expired', revision: occurrence.revision + 1 });
    await this.ctx.audit(tx, 'system', 'raid.expired', { occurrenceId: id, policy: 'release', released });
    await this.ctx.emit(tx, 'raid.expired', { occurrenceId: id, name: occurrence.name, released });
    return true;
  }

  /**
   * Expire open requests past their time. Each open state is queried on its own, so the scan never reads closed
   * requests. It only names candidates: each one expires in its own transaction, read again under its bank's lock.
   */
  async expireRequests(): Promise<string[]> {
    const now = this.ctx.now();
    const candidates = await this.ctx.run(async (tx) => {
      const ids: string[] = [];
      for (const status of OPEN)
        for (const r of await tx.requests.find({ status })) if (r.expiresAt <= now) ids.push(r.id);
      return ids;
    });
    const expired: string[] = [];
    for (const id of candidates) if (await this.ctx.run((tx) => this.expireRequest(tx, id, now))) expired.push(id);
    return expired;
  }

  private async expireRequest(tx: Tx, id: string, now: number): Promise<boolean> {
    await lockRequestSource(tx, id);
    const request = await getRequest(tx, id);
    if (!isOpen(request) || request.expiresAt > now) return false;
    await releaseExpiredRaidHold(tx, request);
    const next = expire(request, now);
    await tx.requests.put(next);
    await this.ctx.emit(tx, 'request.updated', {
      request: requestView(next, await managersOf(tx, next)),
      change: 'expired',
    });
    return true;
  }

  /**
   * TB-DM-09: deliver each pending event at least once. An event is leased before the network call, so a crash mid
   * delivery retries it later; a failure backs off up to an hour and gives up after a day.
   */
  async deliverOutbox(sink: EventSink, limit = 50): Promise<{ delivered: number; failed: number }> {
    const now = this.ctx.now();
    const batch = await this.ctx.run(async (tx) => {
      await tx.lock(['outbox']);
      const due = (await tx.outbox.find({ deliveredAt: null, deadAt: null }))
        .filter((e) => e.nextAttemptAt <= now)
        .sort((a, b) => a.occurredAt - b.occurredAt || a.id.localeCompare(b.id))
        .slice(0, limit);
      for (const event of due) await tx.outbox.put({ ...event, nextAttemptAt: now + 300 });
      return due;
    });
    let delivered = 0;
    let failed = 0;
    for (const event of batch) {
      let outcome: Partial<OutboxEvent>;
      try {
        await sink.deliver({ id: event.id, type: event.type, occurredAt: event.occurredAt, payload: event.payload });
        outcome = { deliveredAt: this.ctx.now(), attempts: event.attempts + 1, lastError: null };
        delivered++;
      } catch (error) {
        const attempts = event.attempts + 1;
        const wait = Math.min(3600, 30 * 2 ** (attempts - 1));
        const giveUp = this.ctx.now() - event.occurredAt > MAX_DELIVERY_SECONDS;
        outcome = {
          attempts,
          lastError: String((error as Error)?.message ?? error).slice(0, 500),
          nextAttemptAt: this.ctx.now() + wait,
          deadAt: giveUp ? this.ctx.now() : null,
        };
        failed++;
      }
      await this.ctx.run(async (tx) => {
        const current = await tx.outbox.get(event.id);
        if (current) await tx.outbox.put({ ...current, ...outcome });
      });
    }
    return { delivered, failed };
  }
}
