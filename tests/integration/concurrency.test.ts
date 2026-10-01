import { PgUnitOfWork, migrate } from '@toadsbank/adapter-postgres';
// Concurrency cases the in-memory fakes cannot prove (spec §9), run in parallel against real PostgreSQL:
// TB-GM-05 two requests for the last 20 items, TB-RL-04 two overlapping allocations, TB-DM-06 a repeated delivery.
import { type Bank, SequentialIds, createBank } from '@toadsbank/application';
import {
  type Actor,
  DomainError,
  type Json,
  canonicalJson,
  encodeParts,
  formatPart,
  utf8Encode,
} from '@toadsbank/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { scratchPool } from './db';

const now = 1_790_800_000;
const admin: Actor = { memberId: '1', name: 'Leigh', roles: ['member', 'officer', 'admin'] };
const frog: Actor = { memberId: '2', name: 'Frog', roles: ['member'] };
const toady: Actor = { memberId: '3', name: 'Toady', roles: ['member'] };

class UniqueIds extends SequentialIds {
  override next(prefix: string): string {
    return `${super.next(prefix)}_${Math.random().toString(36).slice(2, 8)}`;
  }
}

async function seededBank(bank: Bank, guild: string, count: number): Promise<string> {
  const source = await bank.sources.create(
    admin,
    { name: guild, guild, realm: 'Spineshatter', region: 'EU', managers: ['1'] },
    `src-${guild}`,
  );
  const snapshot = {
    schema: 'toadsbank.snapshot',
    schemaVersion: 1,
    snapshotId: `seed-${guild.toLowerCase()}-0001`,
    addon: { version: '0.1.0' },
    client: { flavour: 'forever', build: '0', interface: 0 },
    source: { kind: 'guildBank', guild, realm: 'Spineshatter', region: 'EU' },
    uploader: { name: 'Bankalt', realm: 'Spineshatter' },
    capturedAt: now - 10,
    completedAt: now,
    stable: true,
    tabs: [
      {
        index: 1,
        name: 'A',
        status: 'observed',
        capacity: 98,
        observedAt: now - 5,
        slots: [{ slot: 1, itemId: 22832, count }],
      },
    ],
  };
  const session = await bank.imports.open(admin);
  const parts = encodeParts(utf8Encode(canonicalJson(snapshot as Json)), snapshot.snapshotId).map(formatPart);
  await bank.imports.addParts(admin, session.id, parts.join('\n\n'));
  await bank.imports.accept(admin, session.id, `seed-${guild}`);
  return source.id;
}

describe('PostgreSQL adapter under parallel load', () => {
  let ctx: Awaited<ReturnType<typeof scratchPool>>;
  let bank: Bank;

  beforeAll(async () => {
    ctx = await scratchPool();
    await migrate(ctx.pool);
    bank = createBank({ uow: new PgUnitOfWork(ctx.pool), clock: { now: () => now }, ids: new UniqueIds() });
  });
  afterAll(async () => ctx.drop());

  it('TB-GM-05: two requests for the last 20 items, only one is reserved', async () => {
    const sourceId = await seededBank(bank, 'Lastbank', 20);
    const results = await Promise.allSettled(
      [frog, toady].map((actor) =>
        bank.requests.create(
          actor,
          { sourceId, itemId: 22832, quantity: 20, character: actor.name },
          `req-${actor.memberId}`,
        ),
      ),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const failure = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect((failure.reason as DomainError).code).toBe('insufficient_stock');
    const inventory = await bank.inventory.inventory(admin, { sourceId });
    expect(inventory.items[0]).toMatchObject({ observed: 20, directReserved: 20, available: 0 });
  });

  it('TB-RL-04: two overlapping allocations never exceed projected stock', async () => {
    const sourceId = await seededBank(bank, 'Raidbank', 100);
    const profile = await bank.raids.createProfile(
      admin,
      { name: 'Kara', templates: [{ itemId: 22832, target: 80 }] },
      'profile-kara',
    );
    const nights = await Promise.all(
      [1, 2].map((n) => bank.raids.createOccurrence(admin, profile.id, { startsAt: now + n * 86_400 }, `night-${n}`)),
    );
    const results = await Promise.allSettled(
      nights.map((night, n) =>
        bank.raids.allocate(admin, night.id, { sourceId, itemId: 22832, quantity: 60 }, `alloc-${n}`),
      ),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(((results.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason as DomainError).code).toBe(
      'over_allocated',
    );
    const line = (await bank.inventory.inventory(admin, { sourceId })).items[0];
    expect(line).toMatchObject({ raidHeld: 60, available: 40 });
  });

  it('TB-DM-06: a delivery callback repeated in parallel is recorded once', async () => {
    const sourceId = await seededBank(bank, 'Dlvbank', 50);
    const request = await bank.requests.create(
      frog,
      { sourceId, itemId: 22832, quantity: 10, character: 'Frog' },
      'dlv-req',
    );
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        bank.fulfil.recordDelivery(admin, request.id, request.revision, 10, 'same-callback'),
      ),
    );
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    const line = (await bank.inventory.inventory(admin, { sourceId })).items[0];
    expect(line).toMatchObject({ pendingOutgoing: 10, directReserved: 0, available: 40 });
    const [mine] = await bank.requests.list(frog, 'mine', 'fulfilled');
    expect(mine).toMatchObject({ delivered: 10, revision: 2 });
  });

  it('rolls back a failed transaction completely', async () => {
    const sourceId = await seededBank(bank, 'Rollbank', 5);
    await expect(
      bank.requests.create(frog, { sourceId, itemId: 22832, quantity: 6, character: 'Frog' }, 'too-many'),
    ).rejects.toBeInstanceOf(DomainError);
    expect((await bank.inventory.inventory(admin, { sourceId })).items[0]).toMatchObject({ available: 5 });
    expect((await bank.requests.list(frog, 'mine')).filter((r) => r.sourceId === sourceId)).toHaveLength(0);
  });
});
