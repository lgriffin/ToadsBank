import { type Actor, DomainError, EMPTY_LINE, type StockLine, addLines, canSee, nameFromLink } from '@toadsbank/domain';
import { type Context, getSource, inSequence, stockOf } from './context';
import type { Tx } from './ports';
import { type SourceView, sourceView } from './views';

export interface ReplicaSlot {
  slot: number;
  itemId: number;
  name: string;
  count: number;
  link: string | null;
}

export interface Replica {
  source: SourceView;
  tabs: Array<{
    index: number;
    name: string;
    status: string;
    observedAt: number | null;
    capacity: number;
    slots: ReplicaSlot[];
  }>;
}

export interface InventoryItem extends StockLine {
  itemId: number;
  name: string;
  sources: Array<StockLine & { sourceId: string; observedAt: number | null }>;
}

export interface Inventory {
  /** Capture-time range of the observations behind this aggregate (TB-GM-03). */
  range: { oldest: number | null; newest: number | null };
  items: InventoryItem[];
}

/** BrowseInventory: bank replica, holistic view and source list (TB-GM-01 to 04, TB-RL-03). */
export class BrowseInventory {
  constructor(private readonly ctx: Context) {}

  sources(actor: Actor): Promise<SourceView[]> {
    return this.ctx.run(async (tx) => {
      const sources = (await tx.sources.find())
        .filter((s) => canSee(s, actor))
        .sort((a, b) => a.name.localeCompare(b.name));
      return inSequence(sources, async (s) =>
        sourceView(s, this.ctx.now(), this.ctx.policy.freshness, await tx.baselines.find({ sourceId: s.id })),
      );
    });
  }

  /** TB-GM-01: the bank as captured, tab by tab, in slot order. */
  replica(actor: Actor, sourceId: string): Promise<Replica> {
    return this.ctx.run(async (tx) => {
      const source = await visibleSource(tx, actor, sourceId);
      const baselines = (await tx.baselines.find({ sourceId })).sort((a, b) => a.index - b.index);
      const names = await namesFor(
        tx,
        baselines.flatMap((b) => b.slots.map((s) => s.itemId)),
      );
      return {
        source: sourceView(source, this.ctx.now(), this.ctx.policy.freshness, baselines),
        tabs: baselines.map((b) => ({
          index: b.index,
          name: b.name,
          status: b.lastStatus,
          observedAt: b.observedAt,
          capacity: b.capacity,
          slots: b.slots.map((s) => ({
            slot: s.slot,
            itemId: s.itemId,
            name: nameFromLink(s.link) ?? names.get(s.itemId) ?? `Item ${s.itemId}`,
            count: s.count,
            link: s.link ?? null,
          })),
        })),
      };
    });
  }

  /** TB-RL-03, TB-GM-02, TB-GM-04: every visible bank counted once, with each quantity kind per item. */
  inventory(actor: Actor, filter: { q?: string; sourceId?: string } = {}): Promise<Inventory> {
    return this.ctx.run(async (tx) => {
      const sources = (await tx.sources.find())
        .filter((s) => canSee(s, actor))
        .filter((s) => !filter.sourceId || s.id === filter.sourceId);
      const items = new Map<number, InventoryItem>();
      let oldest: number | null = null;
      let newest: number | null = null;
      for (const source of sources) {
        const baselines = await tx.baselines.find({ sourceId: source.id });
        const observedAt = new Map<number, number>();
        for (const b of baselines) {
          if (b.observedAt === null) continue;
          oldest = oldest === null ? b.observedAt : Math.min(oldest, b.observedAt);
          newest = newest === null ? b.observedAt : Math.max(newest, b.observedAt);
          for (const s of b.slots) observedAt.set(s.itemId, Math.max(observedAt.get(s.itemId) ?? 0, b.observedAt));
        }
        for (const [itemId, line] of await stockOf(tx, source.id)) {
          const item = items.get(itemId) ?? { itemId, name: '', ...EMPTY_LINE, sources: [] };
          Object.assign(item, addLines(item, line));
          item.sources.push({ sourceId: source.id, observedAt: observedAt.get(itemId) ?? null, ...line });
          items.set(itemId, item);
        }
      }
      const names = await namesFor(tx, [...items.keys()]);
      const q = filter.q?.trim().toLowerCase();
      const list = [...items.values()]
        .map((item) => ({ ...item, name: names.get(item.itemId) ?? `Item ${item.itemId}` }))
        .filter((item) => !q || item.name.toLowerCase().includes(q) || String(item.itemId) === q)
        .sort((a, b) => a.name.localeCompare(b.name));
      return { range: { oldest, newest }, items: list };
    });
  }
}

export async function visibleSource(tx: Tx, actor: Actor, sourceId: string) {
  const source = await getSource(tx, sourceId);
  if (!canSee(source, actor)) throw new DomainError('not_found', `no bank ${sourceId}`);
  return source;
}

async function namesFor(tx: Tx, itemIds: number[]): Promise<Map<number, string>> {
  const names = new Map<number, string>();
  for (const itemId of new Set(itemIds)) {
    const doc = await tx.items.get(String(itemId));
    if (doc) names.set(itemId, doc.name);
  }
  return names;
}
