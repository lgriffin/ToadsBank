import {
  type Actor,
  type Json,
  type Snapshot,
  type SnapshotTab,
  canonicalJson,
  encodeParts,
  formatPart,
  utf8Encode,
} from '@toadsbank/domain';
import { ManualClock, MemoryUnitOfWork, SequentialIds, createBank } from '../src/index';

export const POTION = 22832;
export const DAY = 86_400;

export const admin: Actor = { memberId: '1', name: 'Leigh', roles: ['member', 'officer', 'admin'] };
export const gob: Actor = { memberId: '2', name: 'Gob', roles: ['member'] };
export const frog: Actor = { memberId: '3', name: 'Frog', roles: ['member'] };
export const rai: Actor = { memberId: '4', name: 'Rai', roles: ['member'] };
export const olga: Actor = { memberId: '5', name: 'Olga', roles: ['member', 'officer'] };

/** A bank over the in-memory ports, with helpers to register banks and import observations of them. */
export function harness() {
  const uow = new MemoryUnitOfWork();
  const clock = new ManualClock();
  const bank = createBank({ uow, clock, ids: new SequentialIds() });
  let keys = 0;
  let exports = 0;
  const key = () => `key-${++keys}`;

  const tab = (index: number, slots: Array<[number, number]>, observedAt = clock.now() - 5): SnapshotTab => ({
    index,
    name: `Tab ${index}`,
    status: 'observed',
    capacity: 98,
    observedAt,
    slots: slots.map(([itemId, count], i) => ({ slot: i + 1, itemId, count })),
  });

  const snapshot = (guild: string, tabs: SnapshotTab[], patch: Partial<Snapshot> = {}): Snapshot => {
    exports += 1;
    return {
      schema: 'toadsbank.snapshot',
      schemaVersion: 1,
      snapshotId: `export-${String(exports).padStart(4, '0')}-${clock.now()}`,
      addon: { version: '0.1.0' },
      client: { flavour: 'forever', build: '0.0.0', interface: 0 },
      source: { kind: 'guildBank', guild, realm: 'Spineshatter', region: 'EU' },
      uploader: { name: 'Bankalt', realm: 'Spineshatter' },
      capturedAt: clock.now() - 10,
      completedAt: clock.now(),
      stable: true,
      tabs,
      ...patch,
    };
  };

  const parts = (s: Snapshot) =>
    encodeParts(utf8Encode(canonicalJson(s as unknown as Json)), s.snapshotId).map(formatPart);

  /** Open an import and paste every part of the snapshot into it. */
  const staged = async (s: Snapshot, uploader: Actor = admin) => {
    const session = await bank.imports.open(uploader);
    await bank.imports.addParts(uploader, session.id, parts(s).join('\n\n'));
    return session.id;
  };

  const importSnapshot = async (s: Snapshot, uploader: Actor = admin) =>
    bank.imports.accept(uploader, await staged(s, uploader), key());

  /** Register a bank and observe it holding `potions` Super Mana Potions in tab 1. */
  const seeded = async (
    guild: string,
    potions: number,
    options: { audience?: 'members' | 'officers'; managers?: string[] } = {},
  ) => {
    const source = await bank.sources.create(
      admin,
      {
        name: `${guild} bank`,
        guild,
        realm: 'Spineshatter',
        region: 'EU',
        audience: options.audience ?? 'members',
        managers: options.managers ?? [gob.memberId],
      },
      key(),
    );
    await importSnapshot(snapshot(guild, [tab(1, [[POTION, potions]])]));
    return source.id;
  };

  const raid = async (
    name: string,
    target: number,
    options: { inDays?: number; managers?: string[]; sourceIds?: string[] } = {},
  ) => {
    const profile = await bank.raids.createProfile(
      admin,
      {
        name,
        managers: options.managers ?? [admin.memberId],
        templates: [{ itemId: POTION, target }],
        sourceIds: options.sourceIds ?? [],
      },
      key(),
    );
    const startsAt = clock.now() + (options.inDays ?? 1) * DAY;
    return bank.raids.createOccurrence(admin, profile.id, { startsAt }, key());
  };

  const stock = async (actor: Actor, sourceId: string) =>
    (await bank.inventory.inventory(actor, { sourceId })).items.find((i) => i.itemId === POTION);

  return { uow, clock, bank, key, tab, snapshot, parts, staged, importSnapshot, seeded, raid, stock };
}

/** Run `work` and return the DomainError code it failed with, or 'ok'. */
export async function outcome(work: () => Promise<unknown>): Promise<string> {
  try {
    await work();
    return 'ok';
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (!code) throw error;
    return code;
  }
}
