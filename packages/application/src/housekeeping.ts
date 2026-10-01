import { expire, isOpen } from '@toadsbank/domain';
import type { Context } from './context';
import type { EventSink, OutboxEvent } from './ports';
import { managersOf, releaseExpiredRaidHold } from './requestItems';
import { requestView } from './views';

const MAX_DELIVERY_SECONDS = 24 * 3600;

/** Worker jobs: expire raids and requests, and deliver the outbox to the hub. */
export class Housekeeping {
  constructor(private readonly ctx: Context) {}

  /** TB-RL-06: an expired raid returns its unused commitments to general stock and leaves an audit event. */
  async expireRaids(): Promise<string[]> {
    return this.ctx.run(async (tx) => {
      const now = this.ctx.now();
      const due = (await tx.occurrences.find({ status: 'active' })).filter((o) => o.expiresAt <= now);
      for (const occurrence of due) {
        const released: Array<{ sourceId: string; itemId: number; quantity: number }> = [];
        for (const allocation of await tx.allocations.find({ occurrenceId: occurrence.id })) {
          await tx.lock([`source:${allocation.sourceId}`]);
          const requests = await tx.requests.find({
            occurrenceId: occurrence.id,
            sourceId: allocation.sourceId,
            itemId: allocation.itemId,
          });
          const held = requests
            .filter((r) => r.status === 'reserved' || r.status === 'approved')
            .reduce((n, r) => n + r.quantity - r.delivered, 0);
          const unused = Math.max(0, allocation.quantity - held);
          if (unused > 0) released.push({ sourceId: allocation.sourceId, itemId: allocation.itemId, quantity: unused });
          await tx.allocations.put({ ...allocation, quantity: allocation.quantity - unused });
        }
        await tx.occurrences.put({ ...occurrence, status: 'expired', revision: occurrence.revision + 1 });
        await this.ctx.audit(tx, 'system', 'raid.expired', {
          occurrenceId: occurrence.id,
          policy: 'release',
          released,
        });
        await this.ctx.emit(tx, 'raid.expired', { occurrenceId: occurrence.id, name: occurrence.name, released });
      }
      return due.map((o) => o.id);
    });
  }

  async expireRequests(): Promise<string[]> {
    return this.ctx.run(async (tx) => {
      const now = this.ctx.now();
      const due = (await tx.requests.find()).filter((r) => isOpen(r) && r.expiresAt <= now);
      for (const request of due) {
        await tx.lock([`source:${request.sourceId}`]);
        await releaseExpiredRaidHold(tx, request);
        const next = expire(request, now);
        await tx.requests.put(next);
        await this.ctx.emit(tx, 'request.updated', {
          request: requestView(next, await managersOf(tx, next)),
          change: 'expired',
        });
      }
      return due.map((r) => r.id);
    });
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
