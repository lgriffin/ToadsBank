import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  type BankRequest,
  DomainError,
  type Snapshot,
  type TabBaseline,
  applySnapshot,
  approve,
  blocksReservations,
  canManage,
  canSee,
  canUpload,
  cancel,
  deliver,
  expire,
  freshness,
  nameFromLink,
  observedQuantities,
  reject,
  shortfalls,
  sourceKey,
  stockLine,
} from '../src/index';

const request = (patch: Partial<BankRequest> = {}): BankRequest => ({
  id: 'req_1',
  revision: 1,
  status: 'reserved',
  memberId: '1',
  memberName: 'Frog',
  character: 'Frogmage',
  sourceId: 'src_1',
  itemId: 1,
  itemName: 'Thing',
  quantity: 10,
  delivered: 0,
  occurrenceId: null,
  note: '',
  managerNote: null,
  createdAt: 0,
  updatedAt: 0,
  expiresAt: 100,
  ...patch,
});

describe('request transitions', () => {
  it('moves reserved → approved → fulfilled, bumping the revision each time', () => {
    const approved = approve(request(), 5, 'ok');
    expect(approved).toMatchObject({ status: 'approved', revision: 2, managerNote: 'ok', updatedAt: 5 });
    const partly = deliver(approved, 6, 4);
    expect(partly).toMatchObject({ status: 'approved', delivered: 4, revision: 3 });
    expect(deliver(partly, 7, 6)).toMatchObject({ status: 'fulfilled', delivered: 10 });
  });

  it.each([
    ['approve a waitlisted request', () => approve(request({ status: 'waitlisted' }), 1, null)],
    ['deliver to a waitlisted request', () => deliver(request({ status: 'waitlisted' }), 1, 1)],
    ['cancel a fulfilled request', () => cancel(request({ status: 'fulfilled' }), 1)],
    ['reject a cancelled request', () => reject(request({ status: 'cancelled' }), 1, null)],
    ['expire a rejected request', () => expire(request({ status: 'rejected' }), 1)],
  ])('refuses to %s', (_name, act) => {
    expect(act).toThrow(DomainError);
  });

  it('refuses a delivery above what is outstanding, or below one', () => {
    expect(() => deliver(request({ delivered: 8 }), 1, 3)).toThrow(/1 to 2/);
    expect(() => deliver(request(), 1, 0)).toThrow(/1 to 10/);
  });

  it('cancels and keeps what was delivered (TB-GM-07)', () => {
    expect(cancel(request({ delivered: 4 }), 2)).toMatchObject({ status: 'cancelled', delivered: 4 });
  });
});

describe('sources', () => {
  it('keys banks without regard to case or spacing (TB-BM-10)', () => {
    expect(sourceKey({ guild: ' Toads ', realm: 'Spine  Shatter', region: 'eu' })).toBe(
      sourceKey({ guild: 'toads', realm: 'spine shatter', region: 'EU' }),
    );
  });

  it('grades freshness at 24 and 72 hours (TB-GM-08)', () => {
    const now = 1_000_000;
    expect(freshness({ lastObservedAt: null }, now)).toBe('never');
    expect(freshness({ lastObservedAt: now - 24 * 3600 }, now)).toBe('fresh');
    expect(freshness({ lastObservedAt: now - 24 * 3600 - 1 }, now)).toBe('warn');
    expect(freshness({ lastObservedAt: now - 72 * 3600 - 1 }, now)).toBe('stale');
    expect(blocksReservations({ lastObservedAt: now - 72 * 3600 }, now)).toBe(false);
    expect(blocksReservations({ lastObservedAt: null }, now)).toBe(true);
  });

  it('applies audience and manager rules (TB-GM-04)', () => {
    const member = { memberId: '1', name: 'm', roles: ['member'] as const };
    const officer = { memberId: '2', name: 'o', roles: ['member', 'officer'] as const };
    const admin = { memberId: '3', name: 'a', roles: ['admin'] as const };
    const vault = { audience: 'officers' as const, managers: ['1'] };
    expect(canSee({ audience: 'officers', managers: [] }, member)).toBe(false);
    expect(canSee(vault, member)).toBe(true);
    expect(canSee({ audience: 'officers', managers: [] }, officer)).toBe(true);
    expect(canManage({ managers: [] }, officer)).toBe(false);
    expect(canManage({ managers: [] }, admin)).toBe(true);
    expect(canUpload({ managers: [] }, officer)).toBe(true);
    expect(canUpload({ managers: [] }, member)).toBe(false);
  });
});

describe('observations', () => {
  const snapshot = (tabs: Snapshot['tabs']): Snapshot => ({ snapshotId: 'snap-0001', tabs }) as unknown as Snapshot;
  const baseline = (patch: Partial<TabBaseline>): TabBaseline => ({
    sourceId: 's',
    index: 1,
    name: 'A',
    capacity: 98,
    observedAt: 100,
    snapshotId: 'old-00001',
    slots: [{ slot: 1, itemId: 5, count: 3 }],
    lastStatus: 'observed',
    lastAttemptAt: 100,
    ...patch,
  });

  it('replaces a baseline with a newer observation and sorts slots', () => {
    const [decision] = applySnapshot(
      's',
      snapshot([
        {
          index: 1,
          name: 'A',
          status: 'observed',
          capacity: 98,
          observedAt: 200,
          slots: [
            { slot: 3, itemId: 1, count: 1 },
            { slot: 1, itemId: 2, count: 2 },
          ],
        },
      ]),
      new Map([[1, baseline({})]]),
    );
    expect(decision?.outcome).toBe('updated');
    expect(decision?.baseline.slots.map((s) => s.slot)).toEqual([1, 3]);
  });

  it('keeps an older observation as history (TB-BM-08)', () => {
    const [decision] = applySnapshot(
      's',
      snapshot([{ index: 1, name: 'A', status: 'observed', capacity: 98, observedAt: 50, slots: [] }]),
      new Map([[1, baseline({})]]),
    );
    expect(decision).toMatchObject({ outcome: 'keptAsHistory', baseline: { observedAt: 100 } });
  });

  it('never reads an unknown tab as empty (TB-BM-02, TB-BM-09)', () => {
    const [kept, fresh] = applySnapshot(
      's',
      snapshot([
        { index: 1, name: 'A', status: 'unknown', capacity: 98, observedAt: 300, slots: [] },
        { index: 2, name: 'B', status: 'unstable', capacity: 98, observedAt: 300, slots: [] },
      ]),
      new Map([[1, baseline({})]]),
    );
    expect(kept).toMatchObject({
      outcome: 'notRead',
      baseline: { observedAt: 100, lastStatus: 'unknown', slots: [{ count: 3 }] },
    });
    expect(fresh).toMatchObject({
      outcome: 'notRead',
      baseline: { observedAt: null, slots: [], lastStatus: 'unstable' },
    });
  });

  it('sums quantities across tabs', () => {
    expect(
      observedQuantities([baseline({}), baseline({ index: 2, slots: [{ slot: 1, itemId: 5, count: 4 }] })]).get(5),
    ).toBe(7);
  });

  it('reads names from item links', () => {
    expect(nameFromLink('|cffffffff|Hitem:22832::::|h[Super Mana Potion]|h|r')).toBe('Super Mana Potion');
    expect(nameFromLink(undefined)).toBeUndefined();
    expect(nameFromLink('no link')).toBeUndefined();
  });
});

describe('stock maths (TB-GM-02)', () => {
  it('never shows negative availability', () => {
    fc.assert(
      fc.property(
        fc.nat(10_000),
        fc.nat(10_000),
        fc.nat(10_000),
        fc.nat(10_000),
        (observed, pendingOutgoing, raidHeld, directReserved) => {
          const line = stockLine({ observed, pendingOutgoing, raidHeld, directReserved });
          expect(line.available).toBe(Math.max(0, observed - pendingOutgoing - raidHeld - directReserved));
          expect(line.available).toBeGreaterThanOrEqual(0);
        },
      ),
    );
  });
});

describe('raid shortfalls (TB-RL-07)', () => {
  const stock = (entries: Record<string, Record<number, number>>) =>
    new Map(
      Object.entries(entries).map(([sourceId, items]) => [
        sourceId,
        new Map(Object.entries(items).map(([itemId, n]) => [Number(itemId), n])),
      ]),
    );

  it('hands free stock to the earliest raid first', () => {
    const reports = shortfalls(
      [
        { occurrenceId: 'b', startsAt: 20, itemId: 1, target: 50, allocated: 0, sourceIds: [] },
        { occurrenceId: 'a', startsAt: 10, itemId: 1, target: 80, allocated: 10, sourceIds: [] },
      ],
      stock({ s1: { 1: 60 }, s2: { 1: 40 } }),
    );
    expect(reports.map((r) => [r.occurrenceId, r.freeAssigned, r.shortfall])).toEqual([
      ['b', 30, 20],
      ['a', 70, 0],
    ]);
    expect(reports[0]).not.toHaveProperty('sourceIds');
  });

  it('takes free stock only from the banks each raid may draw on, an empty list meaning every bank', () => {
    const reports = shortfalls(
      [
        { occurrenceId: 'a', startsAt: 10, itemId: 1, target: 50, allocated: 0, sourceIds: ['s1'] },
        { occurrenceId: 'b', startsAt: 20, itemId: 1, target: 50, allocated: 0, sourceIds: ['s2'] },
        { occurrenceId: 'c', startsAt: 30, itemId: 1, target: 50, allocated: 0, sourceIds: [] },
        { occurrenceId: 'd', startsAt: 40, itemId: 1, target: 5, allocated: 0, sourceIds: ['s3'] },
      ],
      stock({ s1: { 1: 30, 2: 99 }, s2: { 1: 70 } }),
    );
    expect(reports.map((r) => [r.occurrenceId, r.freeAssigned, r.shortfall])).toEqual([
      ['a', 30, 20],
      ['b', 50, 0],
      ['c', 20, 30],
      ['d', 0, 5],
    ]);
  });

  it('never assigns more free stock than a bank has, and shortfall is max(0, target - eligible)', () => {
    const banks = ['s1', 's2', 's3'];
    const demand = fc.record({
      occurrenceId: fc.string(),
      startsAt: fc.nat(100),
      itemId: fc.integer({ min: 1, max: 3 }),
      target: fc.nat(200),
      allocated: fc.nat(200),
      sourceIds: fc.subarray(banks),
    });
    const free = fc.tuple(fc.nat(300), fc.nat(300), fc.nat(300));
    fc.assert(
      fc.property(fc.array(demand, { maxLength: 8 }), free, (demands, amounts) => {
        const freeStock = new Map(banks.map((b, i) => [b, new Map([1, 2, 3].map((item) => [item, amounts[i] ?? 0]))]));
        const reports = shortfalls(demands, freeStock);
        for (const itemId of [1, 2, 3]) {
          const given = reports.filter((r) => r.itemId === itemId).reduce((n, r) => n + r.freeAssigned, 0);
          expect(given).toBeLessThanOrEqual(amounts.reduce((n, a) => n + a, 0));
        }
        reports.forEach((r, i) => {
          const allowed = demands[i]?.sourceIds.length ? (demands[i]?.sourceIds ?? []) : banks;
          const reachable = allowed.reduce((n, b) => n + (amounts[banks.indexOf(b)] ?? 0), 0);
          expect(r.freeAssigned).toBeLessThanOrEqual(reachable);
          expect(r.freeAssigned).toBeLessThanOrEqual(Math.max(0, r.target - r.allocated));
          expect(r.eligibleAvailable).toBe(r.allocated + r.freeAssigned);
          expect(r.shortfall).toBe(Math.max(0, r.target - r.eligibleAvailable));
        });
      }),
    );
  });
});
