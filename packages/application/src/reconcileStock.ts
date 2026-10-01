import { type Actor, DomainError, canManage, isOfficer } from '@toadsbank/domain';
import { type Context, getSource, itemName, requireString } from './context';
import type { Reconciliation } from './ports';

export interface ReviewView extends Reconciliation {
  itemName: string;
}

/** ReconcileStock: review quantity drops between observations and resolve them (TB-BM-14, TB-BM-15). */
export class ReconcileStock {
  constructor(private readonly ctx: Context) {}

  reviews(actor: Actor, filter: { sourceId?: string; open?: boolean } = {}): Promise<ReviewView[]> {
    if (!isOfficer(actor)) throw new DomainError('forbidden', 'only officers review stock');
    return this.ctx.run(async (tx) => {
      const found = filter.sourceId
        ? await tx.reconciliations.find({ sourceId: filter.sourceId })
        : await tx.reconciliations.find();
      const views: ReviewView[] = [];
      for (const r of found) {
        if (filter.open && r.resolved) continue;
        views.push({ ...r, itemName: await itemName(tx, r.itemId) });
      }
      return views.sort((a, b) => b.createdAt - a.createdAt);
    });
  }

  resolve(actor: Actor, id: string, resolution: unknown, idempotencyKey: string): Promise<ReviewView> {
    return this.ctx.run((tx) =>
      this.ctx.once(tx, actor, idempotencyKey, 'review.resolve', { id, resolution }, async () => {
        const review = await tx.reconciliations.get(id);
        if (!review) throw new DomainError('not_found', `no review ${id}`);
        const source = await getSource(tx, review.sourceId);
        if (!canManage(source, actor))
          throw new DomainError('forbidden', 'only this bank’s managers resolve its reviews');
        const next = {
          ...review,
          resolved: true,
          resolvedBy: actor.memberId,
          resolution: requireString(resolution, 'resolution', 1, 200),
        };
        await tx.reconciliations.put(next);
        await this.ctx.audit(tx, actor.memberId, 'review.resolved', { id });
        return { ...next, itemName: await itemName(tx, next.itemId) };
      }),
    );
  }
}
