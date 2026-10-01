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
}

export interface TargetReport extends TargetDemand {
  freeAssigned: number;
  eligibleAvailable: number;
  shortfall: number;
}

/**
 * TB-RL-07: shortfall per target is max(0, target - eligibleAvailable). Free stock is handed out once across all
 * competing targets, earliest raid first, so two raids never both count the same free potion.
 */
export function shortfalls(demands: readonly TargetDemand[], freeStock: ReadonlyMap<number, number>): TargetReport[] {
  const remaining = new Map(freeStock);
  const ordered = [...demands].sort((a, b) => a.startsAt - b.startsAt || a.occurrenceId.localeCompare(b.occurrenceId));
  const reports = new Map<TargetDemand, TargetReport>();
  for (const demand of ordered) {
    const need = Math.max(0, demand.target - demand.allocated);
    const free = remaining.get(demand.itemId) ?? 0;
    const freeAssigned = Math.min(need, free);
    remaining.set(demand.itemId, free - freeAssigned);
    const eligibleAvailable = demand.allocated + freeAssigned;
    reports.set(demand, {
      ...demand,
      freeAssigned,
      eligibleAvailable,
      shortfall: Math.max(0, demand.target - eligibleAvailable),
    });
  }
  return demands.map((d) => reports.get(d) as TargetReport);
}
