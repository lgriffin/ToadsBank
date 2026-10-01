import type { Snapshot, SnapshotSlot, TabStatus } from '../contract/snapshot';

/** The latest accepted observation of one tab of one source: the baseline every view reads. */
export interface TabBaseline {
  sourceId: string;
  index: number;
  name: string;
  capacity: number;
  /** When these slots were read; null while the tab has never been read. */
  observedAt: number | null;
  snapshotId: string | null;
  slots: SnapshotSlot[];
  /** How the most recent snapshot found the tab: observed, or not read this time (unknown or unstable). */
  lastStatus: TabStatus;
  lastAttemptAt: number;
}

export type TabOutcome = 'updated' | 'keptAsHistory' | 'notRead';

export interface TabDecision {
  index: number;
  outcome: TabOutcome;
  baseline: TabBaseline;
}

/**
 * How an accepted snapshot changes each tab's baseline.
 * - An observed tab replaces the baseline unless the baseline is newer (TB-BM-08: the snapshot becomes history).
 * - An unknown or unstable tab keeps its previous slots and age (TB-BM-02, TB-BM-09), never reads as empty.
 */
export function applySnapshot(
  sourceId: string,
  snapshot: Snapshot,
  current: ReadonlyMap<number, TabBaseline>,
): TabDecision[] {
  return snapshot.tabs.map((tab) => {
    const previous = current.get(tab.index);
    if (tab.status !== 'observed') {
      const baseline: TabBaseline = previous
        ? { ...previous, lastStatus: tab.status, lastAttemptAt: Math.max(previous.lastAttemptAt, tab.observedAt) }
        : {
            sourceId,
            index: tab.index,
            name: tab.name,
            capacity: tab.capacity,
            observedAt: null,
            snapshotId: null,
            slots: [],
            lastStatus: tab.status,
            lastAttemptAt: tab.observedAt,
          };
      return { index: tab.index, outcome: 'notRead', baseline };
    }
    if (previous?.observedAt != null && previous.observedAt > tab.observedAt) {
      return { index: tab.index, outcome: 'keptAsHistory', baseline: previous };
    }
    return {
      index: tab.index,
      outcome: 'updated',
      baseline: {
        sourceId,
        index: tab.index,
        name: tab.name,
        capacity: tab.capacity,
        observedAt: tab.observedAt,
        snapshotId: snapshot.snapshotId,
        slots: [...tab.slots].sort((a, b) => a.slot - b.slot),
        lastStatus: 'observed',
        lastAttemptAt: tab.observedAt,
      },
    };
  });
}

/** Quantity of every item across the given baselines. Occupied slots are the authoritative records. */
export function observedQuantities(baselines: Iterable<TabBaseline>): Map<number, number> {
  const totals = new Map<number, number>();
  for (const tab of baselines)
    for (const slot of tab.slots) totals.set(slot.itemId, (totals.get(slot.itemId) ?? 0) + slot.count);
  return totals;
}

const LINK_NAME = /\|h\[([^\]]{1,120})\]\|h/;

/** The item name inside a WoW item link, if there is one. */
export function nameFromLink(link: string | undefined): string | undefined {
  return link ? LINK_NAME.exec(link)?.[1] : undefined;
}
