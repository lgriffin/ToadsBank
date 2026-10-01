/**
 * Read-then-lock races, staged on the in-memory ports: `beforeLock` commits another transaction's write at the moment
 * a use case waits for a lock, which is what PostgreSQL allows between a read and an advisory lock. Each use case must
 * read what it changes again under the lock. tests/integration/concurrency.test.ts runs the same races for real.
 */
import { type BankRequest, type Json, type Source, canonicalJson, parseParts, sourceKey } from '@toadsbank/domain';
import { describe, expect, it, vi } from 'vitest';
import type { OccurrenceDoc, Tx } from '../src/index';
import { DAY, POTION, admin, frog, gob, harness, outcome } from './harness';

const bankKey = (guild: string) => sourceKey({ guild, realm: 'Spineshatter', region: 'EU' });

describe('imports read under their locks', () => {
  it('TB-BM-10: a first import that waited behind another registers no second source', async () => {
    const h = harness();
    const session = await h.staged(h.snapshot('Newbank', [h.tab(1, [[POTION, 5]])]));
    const theirs: Source = {
      id: 'src_theirs',
      key: bankKey('Newbank'),
      revision: 1,
      name: 'Newbank bank',
      kind: 'guildBank',
      guild: 'Newbank',
      realm: 'Spineshatter',
      region: 'EU',
      audience: 'members',
      raidDay: null,
      managers: [admin.memberId],
      lastObservedAt: null,
      createdAt: h.clock.now(),
    };
    h.uow.beforeLock(`sourceKey:${bankKey('Newbank')}`, (tx) => tx.sources.put(theirs));
    const receipt = await h.bank.imports.accept(admin, session, h.key());
    expect(receipt.sourceId).toBe('src_theirs');
    expect(await h.uow.tx.sources.find({ key: bankKey('Newbank') })).toHaveLength(1);
  });

  it('TB-BM-07: an export accepted by another import while this one waited is a duplicate, not applied twice', async () => {
    const h = harness();
    const sourceId = await h.seeded('Toads', 10);
    const snapshot = h.snapshot('Toads', [h.tab(1, [[POTION, 20]])]);
    const first = await h.staged(snapshot);
    const second = await h.staged(snapshot);
    const theirs = {
      snapshotId: snapshot.snapshotId,
      sourceId,
      acceptedAt: h.clock.now(),
      tabsUpdated: [1],
      tabsKeptAsHistory: [],
      tabsNotRead: [],
      duplicate: false,
    };
    // Another import of the same export commits while this accept waits for the snapshot's lock.
    h.uow.beforeLock(`snapshot:${snapshot.snapshotId}`, async (tx) => {
      await tx.snapshots.put({
        id: snapshot.snapshotId,
        sourceId,
        canonical: canonicalJson(snapshot as unknown as Json),
        capturedAt: snapshot.capturedAt,
        acceptedAt: h.clock.now(),
        acceptedBy: admin.memberId,
        receipt: theirs,
      });
      await tx.importSessions.delete(first);
    });
    const receipt = await h.bank.imports.accept(admin, second, h.key());
    expect(receipt).toMatchObject({ snapshotId: snapshot.snapshotId, sourceId, duplicate: true });
    expect(await h.uow.tx.reconciliations.find({ snapshotId: snapshot.snapshotId })).toHaveLength(0);
  });

  it('TB-BM-10: a manager removed while the upload waited may no longer upload', async () => {
    const h = harness();
    const sourceId = await h.seeded('Toads', 10);
    const session = await h.staged(h.snapshot('Toads', [h.tab(1, [[POTION, 8]])]), gob);
    h.uow.beforeLock(`source:${sourceId}`, async (tx) => {
      const source = (await tx.sources.get(sourceId)) as Source;
      await tx.sources.put({ ...source, revision: source.revision + 1, managers: [] });
    });
    expect(await outcome(() => h.bank.imports.accept(gob, session, h.key()))).toBe('forbidden');
  });

  it('TB-BM-10: accepting keeps a rename that committed while it waited', async () => {
    const h = harness();
    const sourceId = await h.seeded('Toads', 10);
    const session = await h.staged(h.snapshot('Toads', [h.tab(1, [[POTION, 8]])]));
    const before = (await h.uow.tx.sources.get(sourceId)) as Source;
    h.uow.beforeLock(`source:${sourceId}`, async (tx) => {
      await tx.sources.put({ ...before, revision: before.revision + 1, name: 'Renamed' });
    });
    await h.bank.imports.accept(admin, session, h.key());
    expect(await h.uow.tx.sources.get(sourceId)).toMatchObject({ name: 'Renamed', revision: before.revision + 2 });
  });

  it('TB-BM-06: two pastes into one import both count', async () => {
    const h = harness();
    const slots: Array<[number, number]> = Array.from({ length: 98 }, (_, i) => [POTION + (i % 7), i + 1]);
    const snapshot = h.snapshot('Toads', [h.tab(1, slots)]);
    const parts = h.parts(snapshot);
    expect(parts.length).toBeGreaterThan(1);
    const session = await h.bank.imports.open(admin);
    h.uow.beforeLock(`import:${session.id}`, async (tx) => {
      const current = await tx.importSessions.get(session.id);
      const [, ...rest] = parts;
      if (current) {
        const pasted = parseParts(rest.join('\n\n'));
        await tx.importSessions.put({ ...current, exportId: snapshot.snapshotId, parts: pasted });
      }
    });
    const progress = await h.bank.imports.addParts(admin, session.id, parts[0] as string);
    expect(progress).toMatchObject({ complete: true, missing: [] });
    expect(progress.received).toHaveLength(parts.length);
  });
});

describe('request changes read under the bank lock', () => {
  async function cancelledMeanwhile(h: ReturnType<typeof harness>, sourceId: string, request: BankRequest) {
    h.uow.beforeLock(`source:${sourceId}`, async (tx) => {
      const current = (await tx.requests.get(request.id)) as BankRequest;
      await tx.requests.put({ ...current, status: 'cancelled', revision: current.revision + 1 });
    });
  }

  it('TB-BM-16: a delivery against a request cancelled while it waited is refused as stale', async () => {
    const h = harness();
    const sourceId = await h.seeded('Toads', 20);
    const request = await h.bank.requests.create(
      frog,
      { sourceId, itemId: POTION, quantity: 5, character: 'Frog' },
      h.key(),
    );
    await cancelledMeanwhile(h, sourceId, request);
    expect(await outcome(() => h.bank.fulfil.recordDelivery(gob, request.id, request.revision, 5, h.key()))).toBe(
      'stale_revision',
    );
    expect(await h.uow.tx.requests.get(request.id)).toMatchObject({ status: 'cancelled', delivered: 0 });
    expect(await h.uow.tx.deliveries.find()).toHaveLength(0);
  });

  it('TB-BM-16: approving a request cancelled while it waited is refused as stale', async () => {
    const h = harness();
    const sourceId = await h.seeded('Toads', 20);
    const request = await h.bank.requests.create(
      frog,
      { sourceId, itemId: POTION, quantity: 5, character: 'Frog' },
      h.key(),
    );
    await cancelledMeanwhile(h, sourceId, request);
    expect(await outcome(() => h.bank.fulfil.approve(gob, request.id, request.revision, null, h.key()))).toBe(
      'stale_revision',
    );
    expect(await h.uow.tx.requests.get(request.id)).toMatchObject({ status: 'cancelled' });
  });

  it('TB-GM-07: cancelling a request approved while it waited is refused as stale', async () => {
    const h = harness();
    const sourceId = await h.seeded('Toads', 20);
    const request = await h.bank.requests.create(
      frog,
      { sourceId, itemId: POTION, quantity: 5, character: 'Frog' },
      h.key(),
    );
    h.uow.beforeLock(`source:${sourceId}`, async (tx) => {
      const current = (await tx.requests.get(request.id)) as BankRequest;
      await tx.requests.put({ ...current, status: 'approved', revision: current.revision + 1 });
    });
    expect(await outcome(() => h.bank.requests.cancel(frog, request.id, request.revision, h.key()))).toBe(
      'stale_revision',
    );
    expect(await h.uow.tx.requests.get(request.id)).toMatchObject({ status: 'approved' });
  });

  it('expiry leaves alone a request that was cancelled while it waited', async () => {
    const h = harness();
    const sourceId = await h.seeded('Toads', 20);
    const request = await h.bank.requests.create(
      frog,
      { sourceId, itemId: POTION, quantity: 5, character: 'Frog' },
      h.key(),
    );
    h.clock.advance(15 * DAY);
    await cancelledMeanwhile(h, sourceId, request);
    expect(await h.bank.housekeeping.expireRequests()).toEqual([]);
    expect(await h.uow.tx.requests.get(request.id)).toMatchObject({ status: 'cancelled' });
  });

  it('expiry leaves alone a request whose expiry moved on while it waited', async () => {
    const h = harness();
    const sourceId = await h.seeded('Toads', 20);
    const request = await h.bank.requests.create(
      frog,
      { sourceId, itemId: POTION, quantity: 5, character: 'Frog' },
      h.key(),
    );
    h.clock.advance(15 * DAY);
    h.uow.beforeLock(`source:${sourceId}`, async (tx) => {
      const current = (await tx.requests.get(request.id)) as BankRequest;
      await tx.requests.put({ ...current, expiresAt: h.clock.now() + DAY, revision: current.revision + 1 });
    });
    expect(await h.bank.housekeeping.expireRequests()).toEqual([]);
    expect(await h.uow.tx.requests.get(request.id)).toMatchObject({ status: 'reserved' });
  });

  it('expiry and stock queries ask only for open or holding requests, never every request', async () => {
    const h = harness();
    const sourceId = await h.seeded('Toads', 20);
    const request = await h.bank.requests.create(
      frog,
      { sourceId, itemId: POTION, quantity: 5, character: 'Frog' },
      h.key(),
    );
    await h.bank.requests.cancel(frog, request.id, request.revision, h.key());
    const find = vi.spyOn(h.uow.tx.requests, 'find');
    await h.bank.requests.create(frog, { sourceId, itemId: POTION, quantity: 1, character: 'Frog' }, h.key());
    h.clock.advance(15 * DAY);
    await h.bank.housekeeping.expireRequests();
    await h.stock(admin, sourceId);
    expect(find.mock.calls.length).toBeGreaterThan(0);
    for (const [match] of find.mock.calls) expect(match).toHaveProperty('status');
  });
});

describe('raid nights read under their own lock', () => {
  const expire = (id: string) => async (tx: Tx) => {
    const current = (await tx.occurrences.get(id)) as OccurrenceDoc;
    await tx.occurrences.put({ ...current, status: 'expired', revision: current.revision + 1 });
  };

  it('TB-RL-06: an allocation that waited behind the raid expiring is refused', async () => {
    const h = harness();
    const sourceId = await h.seeded('Toads', 100);
    const night = await h.raid('Kara', 30);
    h.uow.beforeLock(`occurrence:${night.id}`, expire(night.id));
    expect(
      await outcome(() => h.bank.raids.allocate(admin, night.id, { sourceId, itemId: POTION, quantity: 10 }, h.key())),
    ).toBe('invalid_transition');
    expect(await h.uow.tx.allocations.find({ occurrenceId: night.id })).toHaveLength(0);
  });

  it('TB-RL-06: an allocation to a raid past its expiry time is refused before the worker runs', async () => {
    const h = harness();
    const sourceId = await h.seeded('Toads', 100);
    const night = await h.raid('Kara', 30);
    h.clock.advance(2 * DAY);
    expect(
      await outcome(() => h.bank.raids.allocate(admin, night.id, { sourceId, itemId: POTION, quantity: 10 }, h.key())),
    ).toBe('invalid_transition');
  });

  it('TB-RL-06: a raid request, waitlisted or not, that waited behind the raid expiring is refused', async () => {
    const h = harness();
    const sourceId = await h.seeded('Toads', 100);
    const night = await h.raid('Kara', 30);
    for (const waitlist of [false, true]) {
      h.uow.beforeLock(`occurrence:${night.id}`, async (tx) => {
        const current = (await tx.occurrences.get(night.id)) as OccurrenceDoc;
        if (current.status === 'active') await expire(night.id)(tx);
      });
      expect(
        await outcome(() =>
          h.bank.requests.create(
            frog,
            { sourceId, itemId: POTION, quantity: 1, character: 'Frog', occurrenceId: night.id, waitlist },
            h.key(),
          ),
        ),
      ).toBe('invalid_transition');
    }
  });

  it('TB-RL-06: the worker expires a raid once, even when another expiry got there first', async () => {
    const h = harness();
    await h.seeded('Toads', 100);
    const night = await h.raid('Kara', 30);
    h.clock.advance(2 * DAY);
    h.uow.beforeLock(`occurrence:${night.id}`, expire(night.id));
    expect(await h.bank.housekeeping.expireRaids()).toEqual([]);
    expect(await h.uow.tx.audit.find({ action: 'raid.expired' })).toHaveLength(0);
  });
});
