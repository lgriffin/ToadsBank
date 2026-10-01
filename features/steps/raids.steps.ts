import assert from 'node:assert/strict';
import { Given, Then, When } from '@cucumber/cucumber';
import type { OccurrenceDoc, ProfileDoc, RequestView } from '@toadsbank/application';
import { type BankWorld, itemId } from '../support/world';

const DAY = 86_400;

async function raid(
  world: BankWorld,
  name: string,
  inDays: number,
  count: number,
  item: string,
  dedicated: string[] = [],
) {
  const admin = world.admin();
  const profile = await world.bank.raids.createProfile(
    admin,
    {
      name,
      templates: [{ itemId: itemId(item), target: count }],
      dedicatedSourceIds: dedicated.map((b) => world.bankRef(b).id),
    },
    world.key(),
  );
  const startsAt = world.clock.now() + inDays * DAY;
  const occurrence = await world.bank.raids.createOccurrence(
    admin,
    profile.id,
    { startsAt, expiresAt: startsAt + 6 * 3600 },
    world.key(),
  );
  world.occurrences.set(name, occurrence.id);
}

Given(
  'a raid {string} starting tomorrow wants {int} {string}',
  async function (this: BankWorld, name: string, count: number, item: string) {
    await raid(this, name, 1, count, item);
  },
);

Given(
  'a raid {string} starting in two days wants {int} {string}',
  async function (this: BankWorld, name: string, count: number, item: string) {
    await raid(this, name, 2, count, item);
  },
);

Given(
  'a raid {string} with dedicated bank {string} starting tomorrow wants {int} {string}',
  async function (this: BankWorld, name: string, bank: string, count: number, item: string) {
    await raid(this, name, 1, count, item, [bank]);
  },
);

When(
  '{word} allocates {int} {string} from {string} to {string}',
  async function (this: BankWorld, name: string, count: number, item: string, bank: string, raidName: string) {
    await this.attempt(() =>
      this.bank.raids.allocate(
        this.actor(name),
        this.occurrences.get(raidName) as string,
        { sourceId: this.bankRef(bank).id, itemId: itemId(item), quantity: count },
        this.key(),
      ),
    );
  },
);

When(
  '{word} requests {int} {string} from {string} for {string}',
  async function (this: BankWorld, name: string, count: number, item: string, bank: string, raidName: string) {
    await this.attempt(() =>
      this.bank.requests.create(
        this.actor(name),
        {
          sourceId: this.bankRef(bank).id,
          itemId: itemId(item),
          quantity: count,
          character: name,
          occurrenceId: this.occurrences.get(raidName),
        },
        this.key(),
      ),
    );
  },
);

Given(
  '{word} has requested {int} {string} from {string} for {string}',
  async function (this: BankWorld, name: string, count: number, item: string, bank: string, raidName: string) {
    const view = await this.bank.requests.create(
      this.actor(name),
      {
        sourceId: this.bankRef(bank).id,
        itemId: itemId(item),
        quantity: count,
        character: name,
        occurrenceId: this.occurrences.get(raidName),
      },
      this.key(),
    );
    assert.equal((view as RequestView).status, 'reserved');
  },
);

Then(
  '{string} can still draw {int} {string}',
  async function (this: BankWorld, raidName: string, count: number, item: string) {
    const view = await this.bank.raids.view(this.admin(), this.occurrences.get(raidName) as string);
    assert.equal(view.allocations.find((a) => a.itemId === itemId(item))?.raidAvailable, count);
  },
);

When('the worker expires raids', async function (this: BankWorld) {
  await this.bank.housekeeping.expireRaids();
});

Then('the audit log records {string}', async function (this: BankWorld, action: string) {
  assert.ok((await this.uow.tx.audit.find({ action })).length > 0);
});

Then(
  '{string} is short {int} {string}',
  async function (this: BankWorld, raidName: string, count: number, item: string) {
    const view = await this.bank.raids.view(this.admin(), this.occurrences.get(raidName) as string);
    assert.equal(view.targets.find((t) => t.itemId === itemId(item))?.shortfall, count);
  },
);

Then(
  'the {string} view shows dedicated bank {string} with {int} {string}',
  async function (this: BankWorld, raidName: string, bank: string, count: number, item: string) {
    const view = await this.bank.raids.view(this.admin(), this.occurrences.get(raidName) as string);
    const dedicated = view.dedicated.find((d) => d.name === bank);
    assert.equal(dedicated?.items.find((i) => i.itemId === itemId(item))?.observed, count);
  },
);

When(
  '{word} creates the raid profile {string} in {string} every {string} managed by {string} wanting {int} {string}',
  async function (
    this: BankWorld,
    name: string,
    raidName: string,
    zone: string,
    recurrence: string,
    manager: string,
    count: number,
    item: string,
  ) {
    this.lastResult = await this.bank.raids.createProfile(
      this.actor(name),
      {
        name: raidName,
        timezone: zone,
        recurrence,
        managers: [this.actor(manager).memberId],
        templates: [{ itemId: itemId(item), target: count }],
      },
      this.key(),
    );
  },
);

Then(
  'the raid profile {string} has timezone {string}, recurrence {string}, {int} manager and {int} template',
  async function (
    this: BankWorld,
    raidName: string,
    zone: string,
    recurrence: string,
    managers: number,
    templates: number,
  ) {
    const profile = (await this.bank.raids.profiles()).find((p) => p.name === raidName) as ProfileDoc;
    assert.deepEqual(
      [profile.timezone, profile.recurrence, profile.managers.length, profile.templates.length],
      [zone, recurrence, managers, templates],
    );
  },
);

When(
  '{word} schedules the next {string} night a week later',
  async function (this: BankWorld, name: string, raidName: string) {
    const first = (await this.uow.tx.occurrences.get(this.occurrences.get(raidName) as string)) as OccurrenceDoc;
    const next = await this.bank.raids.createOccurrence(
      this.actor(name),
      first.profileId,
      { startsAt: first.startsAt + 7 * DAY },
      this.key(),
    );
    this.occurrences.set(`${raidName}:next`, next.id);
  },
);

Then(
  'the next {string} night has no allocations and wants {int} {string}',
  async function (this: BankWorld, raidName: string, count: number, item: string) {
    const view = await this.bank.raids.view(this.admin(), this.occurrences.get(`${raidName}:next`) as string);
    assert.equal(view.allocations.length, 0);
    assert.equal(view.targets.find((t) => t.itemId === itemId(item))?.target, count);
  },
);
