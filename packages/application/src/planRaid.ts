import {
  type Actor,
  DomainError,
  type ItemTarget,
  type TargetDemand,
  type TargetReport,
  canSee,
  isOfficer,
  shortfalls,
} from '@toadsbank/domain';
import { type Context, getSource, inSequence, itemName, requireInt, requireString, stockOf } from './context';
import type { AllocationDoc, OccurrenceDoc, ProfileDoc, Tx } from './ports';
import { raidAvailable } from './raidStock';

export interface ProfileInput {
  name?: unknown;
  timezone?: unknown;
  recurrence?: unknown;
  managers?: unknown;
  templates?: unknown;
  sourceIds?: unknown;
  dedicatedSourceIds?: unknown;
}

export interface RaidView {
  occurrence: OccurrenceDoc;
  profile: ProfileDoc;
  allocations: Array<AllocationDoc & { itemName: string; raidAvailable: number }>;
  targets: Array<TargetReport & { itemName: string }>;
  /** TB-RL-08: physical banks the raid owns, beside its virtual allocations. */
  dedicated: Array<{
    sourceId: string;
    name: string;
    items: Array<{ itemId: number; itemName: string; observed: number; available: number }>;
  }>;
}

/** PlanRaid: profiles, occurrences, allocations and targets (TB-RL-01 to 08). Officers plan; members may look. */
export class PlanRaid {
  constructor(private readonly ctx: Context) {}

  createProfile(actor: Actor, input: ProfileInput, idempotencyKey: string): Promise<ProfileDoc> {
    requireOfficer(actor);
    return this.ctx.run((tx) =>
      this.ctx.once(tx, actor, idempotencyKey, 'raid.profile', input, async () => {
        const profile: ProfileDoc = {
          id: this.ctx.id('raid'),
          revision: 1,
          name: requireString(input.name, 'name', 1, 64),
          timezone: timezone(input.timezone ?? 'Europe/Paris'),
          recurrence: requireString(input.recurrence ?? '', 'recurrence', 0, 200),
          managers: ids(input.managers ?? [actor.memberId], 'managers'),
          templates: targets(input.templates ?? []),
          sourceIds: await sourceIds(tx, input.sourceIds ?? []),
          dedicatedSourceIds: await sourceIds(tx, input.dedicatedSourceIds ?? []),
          expiryPolicy: 'release',
          createdAt: this.ctx.now(),
        };
        await tx.raidProfiles.put(profile);
        return profile;
      }),
    );
  }

  profiles(): Promise<ProfileDoc[]> {
    return this.ctx.run(async (tx) => (await tx.raidProfiles.find()).sort((a, b) => a.name.localeCompare(b.name)));
  }

  occurrences(filter: { profileId?: string } = {}): Promise<OccurrenceDoc[]> {
    return this.ctx.run(async (tx) => {
      const found = filter.profileId
        ? await tx.occurrences.find({ profileId: filter.profileId })
        : await tx.occurrences.find();
      return found.sort((a, b) => a.startsAt - b.startsAt);
    });
  }

  /** TB-RL-02: a new raid night starts with its own, empty allocations and the profile's current targets. */
  createOccurrence(
    actor: Actor,
    profileId: string,
    input: { name?: unknown; startsAt?: unknown; expiresAt?: unknown },
    idempotencyKey: string,
  ) {
    requireOfficer(actor);
    return this.ctx.run((tx) =>
      this.ctx.once(tx, actor, idempotencyKey, 'raid.occurrence', { profileId, input }, async () => {
        const profile = await tx.raidProfiles.get(profileId);
        if (!profile) throw new DomainError('not_found', `no raid profile ${profileId}`);
        const startsAt = requireInt(input.startsAt, 'startsAt', 0, 4_102_444_800);
        const expiresAt = requireInt(input.expiresAt ?? startsAt + 6 * 3600, 'expiresAt', startsAt, 4_102_444_800);
        const occurrence: OccurrenceDoc = {
          id: this.ctx.id('occ'),
          revision: 1,
          profileId,
          name: requireString(input.name ?? profile.name, 'name', 1, 64),
          startsAt,
          expiresAt,
          status: 'active',
          targets: structuredClone(profile.templates),
          createdAt: this.ctx.now(),
        };
        await tx.occurrences.put(occurrence);
        return occurrence;
      }),
    );
  }

  /** TB-RL-04: an allocation may commit only stock that is still generally available, checked under the bank's lock. */
  allocate(
    actor: Actor,
    occurrenceId: string,
    input: { sourceId?: unknown; itemId?: unknown; quantity?: unknown },
    idempotencyKey: string,
  ) {
    return this.ctx.run((tx) =>
      this.ctx.once(tx, actor, idempotencyKey, 'raid.allocate', { occurrenceId, input }, async () => {
        const { occurrence, profile } = await this.managed(tx, actor, occurrenceId);
        if (occurrence.status !== 'active') throw new DomainError('invalid_transition', 'this raid has expired');
        const sourceId = requireString(input.sourceId, 'sourceId', 1, 64);
        const itemId = requireInt(input.itemId, 'itemId', 1, 2_147_483_647);
        const quantity = requireInt(input.quantity, 'quantity', 1, 100_000);
        if (profile.sourceIds.length > 0 && !profile.sourceIds.includes(sourceId)) {
          throw new DomainError('validation_failed', 'this raid may not draw on that bank');
        }
        await getSource(tx, sourceId);
        await tx.lock([`source:${sourceId}`]);
        const available = (await stockOf(tx, sourceId)).get(itemId)?.available ?? 0;
        if (quantity > available) {
          throw new DomainError('over_allocated', `only ${available} can still be committed`, { available });
        }
        const [existing] = await tx.allocations.find({ occurrenceId, sourceId, itemId });
        const allocation: AllocationDoc = existing
          ? { ...existing, quantity: existing.quantity + quantity }
          : { id: this.ctx.id('alc'), occurrenceId, sourceId, itemId, quantity, createdAt: this.ctx.now() };
        await tx.allocations.put(allocation);
        return allocation;
      }),
    );
  }

  /** Hand back part of an allocation, never below what open raid requests already hold. */
  release(actor: Actor, occurrenceId: string, allocationId: string, quantity: unknown, idempotencyKey: string) {
    return this.ctx.run((tx) =>
      this.ctx.once(tx, actor, idempotencyKey, 'raid.release', { occurrenceId, allocationId, quantity }, async () => {
        await this.managed(tx, actor, occurrenceId);
        const allocation = await tx.allocations.get(allocationId);
        if (!allocation || allocation.occurrenceId !== occurrenceId)
          throw new DomainError('not_found', `no allocation ${allocationId}`);
        await tx.lock([`source:${allocation.sourceId}`]);
        const free = await raidAvailable(tx, occurrenceId, allocation.sourceId, allocation.itemId);
        const amount = requireInt(quantity, 'quantity', 1, free === 0 ? 1 : free);
        if (amount > free) throw new DomainError('validation_failed', 'open raid requests hold that stock');
        const next = { ...allocation, quantity: allocation.quantity - amount };
        await tx.allocations.put(next);
        return next;
      }),
    );
  }

  view(actor: Actor, occurrenceId: string): Promise<RaidView> {
    return this.ctx.run(async (tx) => {
      const occurrence = await tx.occurrences.get(occurrenceId);
      if (!occurrence) throw new DomainError('not_found', `no raid ${occurrenceId}`);
      const profile = (await tx.raidProfiles.get(occurrence.profileId)) as ProfileDoc;
      const allocations = await tx.allocations.find({ occurrenceId });
      const allocationViews = await inSequence(allocations, async (a) => ({
        ...a,
        itemName: await itemName(tx, a.itemId),
        raidAvailable: occurrence.status === 'active' ? await raidAvailable(tx, occurrenceId, a.sourceId, a.itemId) : 0,
      }));
      const reports = await this.targetReports(tx);
      const targets = await inSequence(
        reports.filter((r) => r.occurrenceId === occurrenceId),
        async (r) => ({ ...r, itemName: await itemName(tx, r.itemId) }),
      );
      const dedicated = [];
      for (const sourceId of profile.dedicatedSourceIds) {
        const source = await tx.sources.get(sourceId);
        if (!source || !canSee(source, actor)) continue;
        const items = [];
        for (const [itemId, line] of await stockOf(tx, sourceId)) {
          items.push({
            itemId,
            itemName: await itemName(tx, itemId),
            observed: line.observed,
            available: line.available,
          });
        }
        dedicated.push({ sourceId, name: source.name, items });
      }
      return { occurrence, profile, allocations: allocationViews, targets, dedicated };
    });
  }

  /**
   * TB-RL-07 across every active raid: each target counts its own allocations, then free stock from the banks it may
   * draw on is handed out once, earliest raid first.
   */
  private async targetReports(tx: Tx): Promise<TargetReport[]> {
    const active = (await tx.occurrences.find({ status: 'active' })) as OccurrenceDoc[];
    const free = new Map<number, number>();
    for (const source of await tx.sources.find()) {
      for (const [itemId, line] of await stockOf(tx, source.id))
        free.set(itemId, (free.get(itemId) ?? 0) + line.available);
    }
    const demands: TargetDemand[] = [];
    for (const occurrence of active) {
      const allocations = await tx.allocations.find({ occurrenceId: occurrence.id });
      for (const target of occurrence.targets) {
        const allocated = allocations.filter((a) => a.itemId === target.itemId).reduce((n, a) => n + a.quantity, 0);
        demands.push({
          occurrenceId: occurrence.id,
          startsAt: occurrence.startsAt,
          itemId: target.itemId,
          target: target.target,
          allocated,
        });
      }
    }
    return shortfalls(demands, free);
  }

  private async managed(tx: Tx, actor: Actor, occurrenceId: string) {
    const occurrence = await tx.occurrences.get(occurrenceId);
    if (!occurrence) throw new DomainError('not_found', `no raid ${occurrenceId}`);
    const profile = (await tx.raidProfiles.get(occurrence.profileId)) as ProfileDoc;
    if (!isOfficer(actor) && !profile.managers.includes(actor.memberId)) {
      throw new DomainError('forbidden', 'only officers and this raid’s managers plan it');
    }
    return { occurrence, profile };
  }
}

function requireOfficer(actor: Actor): void {
  if (!isOfficer(actor)) throw new DomainError('forbidden', 'only officers plan raids');
}

function timezone(value: unknown): string {
  const zone = requireString(value, 'timezone', 1, 64);
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone });
  } catch {
    throw new DomainError('validation_failed', `unknown timezone ${zone}`);
  }
  return zone;
}

function ids(value: unknown, field: string): string[] {
  if (
    !Array.isArray(value) ||
    value.length > 20 ||
    !value.every((m) => typeof m === 'string' && /^\d{1,20}$/.test(m))
  ) {
    throw new DomainError('validation_failed', `${field} must be up to 20 Discord ids`);
  }
  return [...new Set(value as string[])];
}

function targets(value: unknown): ItemTarget[] {
  if (!Array.isArray(value) || value.length > 100)
    throw new DomainError('validation_failed', 'templates must be a list of up to 100 targets');
  const seen = new Set<number>();
  return value.map((t: { itemId?: unknown; target?: unknown }) => {
    const itemId = requireInt(t?.itemId, 'templates.itemId', 1, 2_147_483_647);
    if (seen.has(itemId)) throw new DomainError('validation_failed', `item ${itemId} has two targets`);
    seen.add(itemId);
    return { itemId, target: requireInt(t?.target, 'templates.target', 1, 100_000) };
  });
}

async function sourceIds(tx: Tx, value: unknown): Promise<string[]> {
  if (!Array.isArray(value) || value.length > 20)
    throw new DomainError('validation_failed', 'sourceIds must be a list');
  for (const id of value) await getSource(tx, requireString(id, 'sourceIds', 1, 64));
  return [...new Set(value as string[])];
}
