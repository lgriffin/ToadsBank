export type ExpiryPolicy = 'release';

export interface ItemTarget {
  itemId: number;
  target: number;
}

/** A recurring raid: who manages it, which banks it may draw on and what it aims to hold (TB-RL-01). */
export interface RaidProfile {
  id: string;
  revision: number;
  name: string;
  timezone: string;
  recurrence: string;
  managers: string[];
  templates: ItemTarget[];
  /** Banks the raid may draw on; empty means every bank. */
  sourceIds: string[];
  /** Physical banks the raid owns outright, shown beside its virtual allocations (TB-RL-08). */
  dedicatedSourceIds: string[];
  expiryPolicy: ExpiryPolicy;
  createdAt: number;
}

export type OccurrenceStatus = 'active' | 'expired';

/** One raid night. It gets its own allocations and copies none from earlier nights (TB-RL-02). */
export interface RaidOccurrence {
  id: string;
  revision: number;
  profileId: string;
  name: string;
  startsAt: number;
  expiresAt: number;
  status: OccurrenceStatus;
  targets: ItemTarget[];
  createdAt: number;
}

/** Stock of one item in one bank committed to one occurrence. `quantity` shrinks as raid requests are delivered. */
export interface Allocation {
  id: string;
  occurrenceId: string;
  sourceId: string;
  itemId: number;
  quantity: number;
  createdAt: number;
}

export interface TargetDemand {
  occurrenceId: string;
  startsAt: number;
  itemId: number;
  target: number;
  allocated: number;
  /** Banks this target may take free stock from; empty means every bank (the raid profile's sourceIds). */
  sourceIds: readonly string[];
}

export interface TargetReport extends Omit<TargetDemand, 'sourceIds'> {
  freeAssigned: number;
  eligibleAvailable: number;
  shortfall: number;
}

/** Free stock per bank: sourceId → itemId → quantity no request or allocation holds. */
export type FreeStock = ReadonlyMap<string, ReadonlyMap<number, number>>;

/**
 * TB-RL-07: shortfall per target is max(0, target - eligibleAvailable). Free stock is handed out once across all
 * competing targets, earliest raid first, and each target only takes from the banks its raid may draw on, so two
 * raids never both count the same free potion and no raid counts a bank it may not use.
 */
export function shortfalls(demands: readonly TargetDemand[], freeStock: FreeStock): TargetReport[] {
  const remaining = new Map([...freeStock].map(([sourceId, items]) => [sourceId, new Map(items)]));
  const banks = [...remaining.keys()].sort();
  const ordered = [...demands].sort((a, b) => a.startsAt - b.startsAt || a.occurrenceId.localeCompare(b.occurrenceId));
  const reports = new Map<TargetDemand, TargetReport>();
  for (const demand of ordered) {
    let need = Math.max(0, demand.target - demand.allocated);
    let freeAssigned = 0;
    const eligible = demand.sourceIds.length > 0 ? banks.filter((b) => demand.sourceIds.includes(b)) : banks;
    for (const sourceId of eligible) {
      const items = remaining.get(sourceId) as Map<number, number>;
      const taken = Math.min(need, items.get(demand.itemId) ?? 0);
      if (taken === 0) continue;
      items.set(demand.itemId, (items.get(demand.itemId) ?? 0) - taken);
      need -= taken;
      freeAssigned += taken;
    }
    const { sourceIds: _sourceIds, ...rest } = demand;
    const eligibleAvailable = demand.allocated + freeAssigned;
    reports.set(demand, {
      ...rest,
      freeAssigned,
      eligibleAvailable,
      shortfall: Math.max(0, demand.target - eligibleAvailable),
    });
  }
  return demands.map((d) => reports.get(d) as TargetReport);
}
