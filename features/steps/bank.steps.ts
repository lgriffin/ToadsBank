import assert from 'node:assert/strict';
import { Given, Then, When } from '@cucumber/cucumber';
import type { Preview, Receipt, RequestView } from '@toadsbank/application';
import type { Role, Snapshot } from '@toadsbank/domain';
import { type BankWorld, RecordingSink, itemId, link } from '../support/world';

// ---- people, banks and observations ------------------------------------------------------------------------------

Given('{word} is a(n) {word}', function (this: BankWorld, name: string, role: Role) {
  this.actor(name, role);
});

Given(
  'the bank {string} is registered with manager {string}',
  async function (this: BankWorld, name: string, manager: string) {
    await this.register(name, manager);
  },
);

Given(
  'the officers-only bank {string} is registered with manager {string}',
  async function (this: BankWorld, name: string, manager: string) {
    await this.register(name, manager, 'officers');
  },
);

Given(
  '{string} was observed holding {int} {string} in tab {int}',
  async function (this: BankWorld, bank: string, count: number, item: string, tab: number) {
    await this.importSnapshot(this.snapshot(bank, [this.tab(tab, [[item, count]])]));
  },
);

Given(
  '{string} was observed holding {int} {string} and {int} {string} in tab {int}',
  async function (this: BankWorld, bank: string, a: number, itemA: string, b: number, itemB: string, tab: number) {
    await this.importSnapshot(
      this.snapshot(bank, [
        this.tab(tab, [
          [itemA, a],
          [itemB, b],
        ]),
      ]),
    );
  },
);

Given(
  '{string} was observed holding {int} {string} in tab {int} and {int} {string} in tab {int}',
  async function (
    this: BankWorld,
    bank: string,
    a: number,
    itemA: string,
    tabA: number,
    b: number,
    itemB: string,
    tabB: number,
  ) {
    await this.importSnapshot(this.snapshot(bank, [this.tab(tabB, [[itemB, b]]), this.tab(tabA, [[itemA, a]])]));
  },
);

Given('the clock moves on {int} {word}', function (this: BankWorld, amount: number, unit: string) {
  const seconds = { minute: 60, minutes: 60, hour: 3600, hours: 3600, day: 86_400, days: 86_400 }[unit];
  assert.ok(seconds, `unknown unit ${unit}`);
  this.clock.advance(amount * seconds);
});

// ---- imports -------------------------------------------------------------------------------------------------------

interface ImportState {
  snapshot?: Snapshot;
  sessionId?: string;
  receipt?: Receipt;
  preview?: Preview;
  complete?: boolean;
}
const imports = new WeakMap<BankWorld, ImportState>();
function state(world: BankWorld): ImportState {
  if (!imports.has(world)) imports.set(world, {});
  return imports.get(world) as ImportState;
}

Given(
  'an export of {string} holding {int} {string} in tab {int}',
  function (this: BankWorld, bank: string, count: number, item: string, tab: number) {
    // One item per slot, so the export runs to several parts.
    const slots: Array<[string, number]> = Array.from({ length: count }, () => [item, 1]);
    const snapshot = this.snapshot(bank, [this.tab(tab, slots)]);
    assert.ok(this.partsOf(snapshot).length > 1, 'the export should span several parts');
    state(this).snapshot = snapshot;
  },
);

When('{word} pastes the parts in reverse order', async function (this: BankWorld, name: string) {
  const actor = this.actor(name);
  const s = state(this);
  const session = await this.bank.imports.open(actor);
  s.sessionId = session.id;
  const parts = this.partsOf(s.snapshot as Snapshot).reverse();
  let progress = { complete: false };
  for (const part of parts) progress = await this.bank.imports.addParts(actor, session.id, `\`\`\`\n${part}\n\`\`\``);
  s.complete = progress.complete;
  s.preview = await this.bank.imports.preview(actor, session.id);
});

When('{word} pastes the parts with one character changed', async function (this: BankWorld, name: string) {
  const actor = this.actor(name);
  const s = state(this);
  const session = await this.bank.imports.open(actor);
  s.sessionId = session.id;
  const [first, ...rest] = this.partsOf(s.snapshot as Snapshot);
  const lines = (first as string).split('\n');
  const payload = lines[1] as string;
  lines[1] = `${payload.slice(0, 10)}${payload[10] === 'A' ? 'B' : 'A'}${payload.slice(11)}`;
  await this.bank.imports.addParts(actor, session.id, [lines.join('\n'), ...rest].join('\n\n'));
});

When('{word} previews the import', async function (this: BankWorld, name: string) {
  await this.attempt(() => this.bank.imports.preview(this.actor(name), state(this).sessionId as string));
});

Then('the import is complete', function (this: BankWorld) {
  assert.equal(state(this).complete, true);
});

Then(
  'the preview shows tab {int} with {int} occupied slot(s)',
  function (this: BankWorld, index: number, occupied: number) {
    const tab = state(this).preview?.tabs.find((t) => t.index === index);
    assert.equal(tab?.occupied, occupied);
  },
);

Given('{word} imports it', async function (this: BankWorld, name: string) {
  state(this).receipt = await this.importSnapshot(state(this).snapshot as Snapshot, this.actor(name));
});

When('{word} imports it again', async function (this: BankWorld, name: string) {
  state(this).receipt = await this.importSnapshot(state(this).snapshot as Snapshot, this.actor(name));
});

When('{word} imports a changed export with the same snapshot id', async function (this: BankWorld, name: string) {
  const changed = structuredClone(state(this).snapshot as Snapshot);
  (changed.tabs[0]?.slots[0] as { count: number }).count += 1;
  await this.attempt(() => this.importSnapshot(changed, this.actor(name)));
});

Then('the receipt is marked as a duplicate', function (this: BankWorld) {
  assert.equal(state(this).receipt?.duplicate, true);
});

Then('{string} has had {int} snapshot(s) accepted', async function (this: BankWorld, bank: string, count: number) {
  assert.equal((await this.uow.tx.snapshots.find({ sourceId: this.bankRef(bank).id })).length, count);
});

When(
  '{word} imports an export of {string} captured an hour earlier holding {int} {string} in tab {int}',
  async function (this: BankWorld, name: string, bank: string, count: number, item: string, tab: number) {
    const earlier = this.clock.now() - 3600;
    const snapshot = this.snapshot(bank, [this.tab(tab, [[item, count]], earlier)], {
      capturedAt: earlier - 10,
      completedAt: earlier,
    });
    state(this).receipt = await this.importSnapshot(snapshot, this.actor(name));
  },
);

When(
  '{word} imports an export of {string} with tab {int} holding {int} {string} and tab {int} unknown',
  async function (
    this: BankWorld,
    name: string,
    bank: string,
    tab: number,
    count: number,
    item: string,
    unknown: number,
  ) {
    const snapshot = this.snapshot(bank, [this.tab(tab, [[item, count]]), this.unknownTab(unknown)]);
    state(this).receipt = await this.importSnapshot(snapshot, this.actor(name));
  },
);

When(
  '{word} imports an export of {string} with tab {int} holding {int} {string}',
  async function (this: BankWorld, name: string, bank: string, tab: number, count: number, item: string) {
    const snapshot = this.snapshot(bank, [this.tab(tab, [[item, count]])]);
    await this.attempt(async () => {
      state(this).receipt = await this.importSnapshot(snapshot, this.actor(name));
    });
    if (this.lastError && !['forbidden'].includes(this.lastError.code)) throw this.lastError;
  },
);

Then('tab {int} of {string} was kept as history', function (this: BankWorld, tab: number, _bank: string) {
  assert.deepEqual(state(this).receipt?.tabsKeptAsHistory, [tab]);
});

Then(
  'tab {int} of {string} is marked as not currently read and keeps its age',
  async function (this: BankWorld, tab: number, bank: string) {
    const replica = await this.bank.inventory.replica(this.admin(), this.bankRef(bank).id);
    const found = replica.tabs.find((t) => t.index === tab);
    assert.equal(found?.status, 'unknown');
    assert.ok(found?.observedAt !== null && (found?.observedAt as number) < this.clock.now() - 3600);
  },
);

Then('there is {int} bank(s)', async function (this: BankWorld, count: number) {
  assert.equal((await this.bank.inventory.sources(this.admin())).length, count);
});

Given('{word} opens an import', async function (this: BankWorld, name: string) {
  state(this).sessionId = (await this.bank.imports.open(this.actor(name))).id;
});

When('{word} pastes the parts into the open import', async function (this: BankWorld, name: string) {
  const text = this.partsOf(state(this).snapshot as Snapshot).join('\n\n');
  await this.attempt(() => this.bank.imports.addParts(this.actor(name), state(this).sessionId as string, text));
});

// ---- the outbox ----------------------------------------------------------------------------------------------------

const sinks = new WeakMap<BankWorld, RecordingSink>();
function sink(world: BankWorld): RecordingSink {
  if (!sinks.has(world)) sinks.set(world, new RecordingSink());
  return sinks.get(world) as RecordingSink;
}

Given('the hub is down for {int} deliver(y)(ies)', function (this: BankWorld, count: number) {
  sink(this).failNext = count;
});

When('the worker delivers the outbox', async function (this: BankWorld) {
  await this.bank.housekeeping.deliverOutbox(sink(this));
});

Then('the hub received {int} {string} event(s)', function (this: BankWorld, count: number, type: string) {
  assert.equal(sink(this).delivered.filter((e) => e.type === type).length, count);
});

// ---- inventory -----------------------------------------------------------------------------------------------------

When('{word} opens the replica of {string}', async function (this: BankWorld, name: string, bank: string) {
  this.lastResult = await this.bank.inventory.replica(this.actor(name), this.bankRef(bank).id);
});

Then(
  'the replica shows tab {int} slot {int} holding {int} {string}',
  function (this: BankWorld, tab: number, slot: number, count: number, item: string) {
    const replica = this.lastResult as Awaited<ReturnType<BankWorld['bank']['inventory']['replica']>>;
    const found = replica.tabs.find((t) => t.index === tab)?.slots.find((s) => s.slot === slot);
    assert.deepEqual(found && { count: found.count, name: found.name, link: found.link }, {
      count,
      name: item,
      link: link(item),
    });
  },
);

async function line(world: BankWorld, name: string, item: string) {
  const inventory = await world.bank.inventory.inventory(world.actor(name));
  return inventory.items.find((i) => i.itemId === itemId(item));
}

Then(
  '{word} sees {int} {string} observed',
  async function (this: BankWorld, name: string, count: number, item: string) {
    assert.equal((await line(this, name, item))?.observed ?? 0, count);
  },
);

Then(
  '{word} sees {int} {string} available',
  async function (this: BankWorld, name: string, count: number, item: string) {
    assert.equal((await line(this, name, item))?.available ?? 0, count);
  },
);

Then(
  '{word} sees {string} as observed {int}, pending {int}, raid held {int}, reserved {int}, available {int}',
  async function (
    this: BankWorld,
    name: string,
    item: string,
    observed: number,
    pending: number,
    raid: number,
    reserved: number,
    available: number,
  ) {
    const found = await line(this, name, item);
    assert.deepEqual(
      found && {
        o: found.observed,
        p: found.pendingOutgoing,
        r: found.raidHeld,
        d: found.directReserved,
        a: found.available,
      },
      { o: observed, p: pending, r: raid, d: reserved, a: available },
    );
  },
);

Then('{word} sees {int} bank(s)', async function (this: BankWorld, name: string, count: number) {
  assert.equal((await this.bank.inventory.sources(this.actor(name))).length, count);
});

Then("the inventory's capture range spans {int} hours", async function (this: BankWorld, hours: number) {
  const { range } = await this.bank.inventory.inventory(this.admin());
  assert.equal((range.newest as number) - (range.oldest as number), hours * 3600);
});

Then('{string} is {string}', async function (this: BankWorld, bank: string, freshness: string) {
  const sources = await this.bank.inventory.sources(this.admin());
  assert.equal(sources.find((s) => s.id === this.bankRef(bank).id)?.freshness, freshness);
});

// ---- requests ------------------------------------------------------------------------------------------------------

async function request(
  world: BankWorld,
  name: string,
  count: number,
  item: string,
  bank: string,
  extra: Record<string, unknown> = {},
  key = world.key(),
) {
  const view = await world.attempt(() =>
    world.bank.requests.create(
      world.actor(name),
      { sourceId: world.bankRef(bank).id, itemId: itemId(item), quantity: count, character: `${name}char`, ...extra },
      key,
    ),
  );
  if (view) world.requests.set(name, view);
  return view;
}

When(
  '{word} requests {int} {string} from {string}',
  async function (this: BankWorld, name: string, count: number, item: string, bank: string) {
    await request(this, name, count, item, bank);
  },
);

When(
  '{word} requests {int} {string} from {string} on the website',
  async function (this: BankWorld, name: string, count: number, item: string, bank: string) {
    await request(this, name, count, item, bank);
  },
);

When(
  '{word} requests {int} {string} from {string} in Discord',
  async function (this: BankWorld, name: string, count: number, item: string, bank: string) {
    // The hub's bot and website call the same use case; only the adapter differs.
    await request(this, name, count, item, bank);
  },
);

Given(
  '{word} has requested {int} {string} from {string}',
  async function (this: BankWorld, name: string, count: number, item: string, bank: string) {
    assert.ok(await request(this, name, count, item, bank), this.lastError?.message);
  },
);

When(
  '{word} waitlists {int} {string} from {string}',
  async function (this: BankWorld, name: string, count: number, item: string, bank: string) {
    await request(this, name, count, item, bank, { waitlist: true });
  },
);

When(
  '{word} requests {int} {string} from {string} twice with the same key',
  async function (this: BankWorld, name: string, count: number, item: string, bank: string) {
    await request(this, name, count, item, bank, {}, 'same-key');
    await request(this, name, count, item, bank, {}, 'same-key');
  },
);

When(
  '{word} requests {int} {string} from {string} with key {string}',
  async function (this: BankWorld, name: string, count: number, item: string, bank: string, key: string) {
    await request(this, name, count, item, bank, {}, key);
  },
);

Then('the request is {string}', function (this: BankWorld, status: string) {
  assert.equal(this.lastError, undefined, this.lastError?.message);
  assert.equal((this.lastResult as RequestView).status, status);
});

Then('the request is {string} with {int} delivered', function (this: BankWorld, status: string, delivered: number) {
  assert.equal(this.lastError, undefined, this.lastError?.message);
  const view = this.lastResult as RequestView;
  assert.deepEqual([view.status, view.delivered], [status, delivered]);
});

Then('the call fails with {string}', function (this: BankWorld, code: string) {
  assert.equal(this.lastError?.code, code, this.lastError ? this.lastError.message : 'the call succeeded');
});

Then(
  'the call fails with {string} offering a waitlist with {int} available',
  function (this: BankWorld, code: string, available: number) {
    assert.equal(this.lastError?.code, code);
    assert.deepEqual(this.lastError?.details, { available, canWaitlist: true });
  },
);

Then(
  'the call fails with {string} showing the request as {string}',
  function (this: BankWorld, code: string, status: string) {
    assert.equal(this.lastError?.code, code);
    assert.equal((this.lastError?.current as RequestView).status, status);
  },
);

Then('{word} is told about the request', async function (this: BankWorld, manager: string) {
  const assigned = await this.events('request.assigned');
  assert.ok(
    assigned.some((e) => (e.payload as { managers: string[] }).managers.includes(this.actor(manager).memberId)),
  );
});

Then("{word}'s queue lists {int} request(s)", async function (this: BankWorld, manager: string, count: number) {
  assert.equal((await this.bank.requests.list(this.actor(manager), 'queue')).length, count);
});

Then('{word} has {int} request(s)', async function (this: BankWorld, name: string, count: number) {
  assert.equal((await this.bank.requests.list(this.actor(name), 'mine')).length, count);
});

When('{word} cancels the request', async function (this: BankWorld, name: string) {
  const current = (await this.bank.requests.list(this.actor(name), 'mine'))[0] as RequestView;
  await this.attempt(() => this.bank.requests.cancel(this.actor(name), current.id, current.revision, this.key()));
});

async function current(world: BankWorld, owner: string): Promise<RequestView> {
  const views = await world.bank.requests.list(world.actor(owner), 'mine');
  return views[views.length - 1] as RequestView;
}

Given(
  "{word} has delivered {int} of {word}'s request",
  async function (this: BankWorld, manager: string, count: number, owner: string) {
    const view = await current(this, owner);
    await this.bank.fulfil.recordDelivery(this.actor(manager), view.id, view.revision, count, this.key());
  },
);

When(
  "{word} delivers {int} of {word}'s request",
  async function (this: BankWorld, manager: string, count: number, owner: string) {
    const view = await current(this, owner);
    await this.attempt(() =>
      this.bank.fulfil.recordDelivery(this.actor(manager), view.id, view.revision, count, this.key()),
    );
  },
);

Given("{word} approves {word}'s request", async function (this: BankWorld, manager: string, owner: string) {
  const view = await current(this, owner);
  this.requests.set(`${owner}:before-approval`, view);
  await this.attempt(() => this.bank.fulfil.approve(this.actor(manager), view.id, view.revision, 'ok', this.key()));
});

When(
  "{word} rejects {word}'s request using the revision from before the approval",
  async function (this: BankWorld, manager: string, owner: string) {
    const before = this.requests.get(`${owner}:before-approval`) as RequestView;
    await this.attempt(() =>
      this.bank.fulfil.reject(this.actor(manager), before.id, before.revision, 'no', this.key()),
    );
  },
);

Then('the stock review for {string} says {string}', async function (this: BankWorld, item: string, label: string) {
  const reviews = await this.bank.reconcile.reviews(this.admin());
  assert.equal(reviews.find((r) => r.itemId === itemId(item))?.label, label);
});

Then('the stock review names no member', async function (this: BankWorld) {
  const reviews = await this.bank.reconcile.reviews(this.admin());
  const text = JSON.stringify(reviews);
  for (const actor of this.actors.values()) {
    if (actor.name === 'Leigh') continue;
    assert.ok(!text.includes(`"${actor.memberId}"`) && !text.includes(actor.name), `review mentions ${actor.name}`);
  }
});
