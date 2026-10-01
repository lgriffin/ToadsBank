import { After, Before, World, setWorldConstructor } from '@cucumber/cucumber';
import {
  type Bank,
  type EventSink,
  ManualClock,
  MemoryUnitOfWork,
  type OutboxEvent,
  type RequestView,
  SequentialIds,
  createBank,
} from '@toadsbank/application';
import {
  type Actor,
  DomainError,
  type Json,
  type Role,
  type Snapshot,
  type SnapshotSlot,
  type SnapshotTab,
  canonicalJson,
  encodeParts,
  formatPart,
  utf8Encode,
} from '@toadsbank/domain';

export const ITEMS: Record<string, number> = {
  'Major Mana Potion': 13444,
  'Super Mana Potion': 22832,
  'Super Healing Potion': 22829,
  'Haste Potion': 22838,
  'Flask of Relentless Assault': 22854,
  'Flask of Blinding Light': 22861,
  'Primal Life': 21886,
  'Primal Mana': 22457,
};

export function itemId(name: string): number {
  const id = ITEMS[name];
  if (!id) throw new Error(`unknown test item ${name}`);
  return id;
}

export function link(name: string): string {
  return `|cffffffff|Hitem:${itemId(name)}::::::::70:::::|h[${name}]|h|r`;
}

interface BankRef {
  id: string;
  guild: string;
  realm: string;
}

export class BankWorld extends World {
  clock = new ManualClock(1_790_800_000);
  uow = new MemoryUnitOfWork();
  bank: Bank = createBank({ uow: this.uow, clock: this.clock, ids: new SequentialIds() });
  actors = new Map<string, Actor>();
  banks = new Map<string, BankRef>();
  requests = new Map<string, RequestView>();
  occurrences = new Map<string, string>();
  lastError: DomainError | undefined;
  lastResult: unknown;
  keys = 0;
  exports = 0;

  key(): string {
    this.keys += 1;
    return `key-${this.keys}`;
  }

  actor(name: string, role: Role = 'member'): Actor {
    let actor = this.actors.get(name);
    if (!actor) {
      const roles: Role[] =
        role === 'admin' ? ['member', 'officer', 'admin'] : role === 'officer' ? ['member', 'officer'] : ['member'];
      actor = { memberId: String(100 + this.actors.size), name, roles };
      this.actors.set(name, actor);
    }
    return actor;
  }

  admin(): Actor {
    return this.actor('Leigh', 'admin');
  }

  bankRef(name: string): BankRef {
    const ref = this.banks.get(name);
    if (!ref) throw new Error(`no bank called ${name} in this scenario`);
    return ref;
  }

  async register(name: string, manager: string, audience: 'members' | 'officers' = 'members'): Promise<BankRef> {
    const guild = name.split(' ')[0] ?? name;
    const realm = `Realm${this.banks.size + 1}`;
    const view = await this.bank.sources.create(
      this.admin(),
      { name, guild, realm, region: 'EU', audience, managers: [this.actor(manager).memberId] },
      this.key(),
    );
    const ref = { id: view.id, guild, realm };
    this.banks.set(name, ref);
    return ref;
  }

  snapshot(bankName: string, tabs: SnapshotTab[], options: Partial<Snapshot> = {}): Snapshot {
    const ref = this.bankRef(bankName);
    this.exports += 1;
    const now = this.clock.now();
    return {
      schema: 'toadsbank.snapshot',
      schemaVersion: 1,
      snapshotId: `export-${String(this.exports).padStart(4, '0')}-${now}`,
      addon: { version: '0.1.0' },
      client: { flavour: 'forever', build: '0.0.0', interface: 0 },
      source: { kind: 'guildBank', guild: ref.guild, realm: ref.realm, region: 'EU' },
      uploader: { name: 'Bankalt', realm: ref.realm },
      capturedAt: now - 10,
      completedAt: now,
      stable: true,
      tabs,
      ...options,
    };
  }

  tab(index: number, slots: Array<[string, number]>, observedAt = this.clock.now() - 5): SnapshotTab {
    const ordered: SnapshotSlot[] = slots.map(([name, count], i) => ({
      slot: i + 1,
      itemId: itemId(name),
      count,
      link: link(name),
    }));
    return { index, name: `Tab ${index}`, status: 'observed', capacity: 98, observedAt, slots: ordered };
  }

  unknownTab(index: number): SnapshotTab {
    return {
      index,
      name: `Tab ${index}`,
      status: 'unknown',
      capacity: 98,
      observedAt: this.clock.now() - 5,
      slots: [],
    };
  }

  partsOf(snapshot: Snapshot): string[] {
    return encodeParts(utf8Encode(canonicalJson(snapshot as unknown as Json)), snapshot.snapshotId).map(formatPart);
  }

  async importSnapshot(snapshot: Snapshot, uploader: Actor = this.admin()) {
    const session = await this.bank.imports.open(uploader);
    await this.bank.imports.addParts(uploader, session.id, this.partsOf(snapshot).join('\n\n'));
    return this.bank.imports.accept(uploader, session.id, this.key());
  }

  async attempt<T>(work: () => Promise<T>): Promise<T | undefined> {
    this.lastError = undefined;
    try {
      this.lastResult = await work();
      return this.lastResult as T;
    } catch (error) {
      if (!(error instanceof DomainError)) throw error;
      this.lastError = error;
      return undefined;
    }
  }

  async events(type?: string): Promise<OutboxEvent[]> {
    const all = await this.uow.tx.outbox.find();
    return all.filter((e) => !type || e.type === type);
  }
}

export class RecordingSink implements EventSink {
  delivered: Array<{ id: string; type: string }> = [];
  failNext = 0;

  async deliver(event: { id: string; type: string }): Promise<void> {
    if (this.failNext > 0) {
      this.failNext -= 1;
      throw new Error('hub unavailable');
    }
    this.delivered.push({ id: event.id, type: event.type });
  }
}

setWorldConstructor(BankWorld);

Before(function (this: BankWorld) {
  this.lastError = undefined;
});

After(function (this: BankWorld) {
  this.actors.clear();
});
