/** Rules the review asked for that need no interleaving: covering observations, raid visibility and raid targets. */
import { describe, expect, it } from 'vitest';
import { POTION, admin, frog, gob, harness, olga, outcome, rai } from './harness';

describe('TB-BM-14: only a covering observation clears pending outgoing', () => {
  async function delivered() {
    const h = harness();
    await h.bank.sources.create(
      admin,
      { name: 'Toads bank', guild: 'Toads', realm: 'Spineshatter', region: 'EU', managers: [gob.memberId] },
      h.key(),
    );
    const receipt = await h.importSnapshot(h.snapshot('Toads', [h.tab(1, [[POTION, 10]]), h.tab(2, [[POTION, 10]])]));
    const sourceId = receipt.sourceId;
    const request = await h.bank.requests.create(
      frog,
      { sourceId, itemId: POTION, quantity: 5, character: 'Frog' },
      h.key(),
    );
    await h.bank.fulfil.recordDelivery(gob, request.id, request.revision, 5, h.key());
    h.clock.advance(3600);
    return { h, sourceId };
  }

  it('keeps the pending outgoing after a scan that skipped a tab the bank has', async () => {
    const { h, sourceId } = await delivered();
    await h.importSnapshot(h.snapshot('Toads', [h.tab(1, [[POTION, 5]])]));
    expect(await h.stock(admin, sourceId)).toMatchObject({ observed: 15, pendingOutgoing: 5, available: 10 });
    expect(await h.uow.tx.deliveries.find({ cleared: true })).toHaveLength(0);
  });

  it('keeps the pending outgoing after a scan with no tabs at all', async () => {
    const { h, sourceId } = await delivered();
    await h.importSnapshot(h.snapshot('Toads', []));
    expect(await h.stock(admin, sourceId)).toMatchObject({ pendingOutgoing: 5 });
  });

  it('clears it once every tab is read again after the delivery', async () => {
    const { h, sourceId } = await delivered();
    await h.importSnapshot(h.snapshot('Toads', [h.tab(1, [[POTION, 5]]), h.tab(2, [[POTION, 10]])]));
    expect(await h.stock(admin, sourceId)).toMatchObject({ observed: 15, pendingOutgoing: 0, available: 15 });
    expect(await h.uow.tx.reconciliations.find({ label: 'consistent_with_reported_movement' })).toHaveLength(1);
  });
});

describe('TB-GM-04: raid views and plans stay inside the banks a member may see', () => {
  async function privateRaid() {
    const h = harness();
    const open = await h.seeded('Toads', 40);
    const hidden = await h.seeded('Vault', 100, { audience: 'officers', managers: [olga.memberId] });
    const night = await h.raid('Kara', 80, { managers: [rai.memberId] });
    await h.bank.raids.allocate(admin, night.id, { sourceId: open, itemId: POTION, quantity: 10 }, h.key());
    await h.bank.raids.allocate(admin, night.id, { sourceId: hidden, itemId: POTION, quantity: 30 }, h.key());
    return { h, open, hidden, night };
  }

  it("shows a member neither a private bank's allocation nor its stock in the targets", async () => {
    const { h, open, night } = await privateRaid();
    const view = await h.bank.raids.view(frog, night.id);
    expect(view.allocations.map((a) => a.sourceId)).toEqual([open]);
    // Only Toads counts: 10 allocated plus its 30 free potions.
    expect(view.targets[0]).toMatchObject({ allocated: 10, freeAssigned: 30, eligibleAvailable: 40, shortfall: 40 });
  });

  it('shows an officer every bank', async () => {
    const { h, night } = await privateRaid();
    const view = await h.bank.raids.view(admin, night.id);
    expect(view.allocations).toHaveLength(2);
    expect(view.targets[0]).toMatchObject({ allocated: 40, freeAssigned: 40, eligibleAvailable: 80, shortfall: 0 });
  });

  it("lets a raid's manager allocate only from banks they can see and manage", async () => {
    const { h, open, hidden, night } = await privateRaid();
    const allocate = (sourceId: string) =>
      outcome(() => h.bank.raids.allocate(rai, night.id, { sourceId, itemId: POTION, quantity: 1 }, h.key()));
    expect(await allocate(hidden)).toBe('not_found');
    expect(await allocate(open)).toBe('forbidden');
    await h.bank.sources.update(admin, open, { expectedRevision: 2, managers: [gob.memberId, rai.memberId] }, h.key());
    expect(await allocate(open)).toBe('ok');
  });

  it("does not let a raid's manager release an allocation from a bank they cannot see", async () => {
    const { h, hidden, night } = await privateRaid();
    const [allocation] = await h.uow.tx.allocations.find({ sourceId: hidden });
    expect(await outcome(() => h.bank.raids.release(rai, night.id, allocation?.id as string, 1, h.key()))).toBe(
      'not_found',
    );
  });

  it("gives a raid's managers no say over raid requests on a private bank", async () => {
    const { h, open, hidden, night } = await privateRaid();
    const onHidden = await h.bank.requests.create(
      olga,
      { sourceId: hidden, itemId: POTION, quantity: 5, character: 'Olga', occurrenceId: night.id },
      h.key(),
    );
    expect(onHidden.managers).toEqual([olga.memberId]);
    expect(await outcome(() => h.bank.fulfil.approve(rai, onHidden.id, onHidden.revision, null, h.key()))).toBe(
      'forbidden',
    );
    const onOpen = await h.bank.requests.create(
      frog,
      { sourceId: open, itemId: POTION, quantity: 5, character: 'Frog', occurrenceId: night.id },
      h.key(),
    );
    expect(onOpen.managers).toEqual([gob.memberId, rai.memberId]);
    const assigned = (await h.uow.tx.outbox.find({ type: 'request.assigned' })).map(
      (e) => (e.payload as { managers: string[] }).managers,
    );
    expect(assigned).toEqual([[olga.memberId], [gob.memberId, rai.memberId]]);
  });
});

describe('TB-RL-05: a raid request names a raid night that exists and is active', () => {
  it('refuses a waitlisted request for an unknown or expired raid night', async () => {
    const h = harness();
    const sourceId = await h.seeded('Toads', 10);
    const night = await h.raid('Kara', 30);
    const waitlist = (occurrenceId: string) =>
      outcome(() =>
        h.bank.requests.create(
          frog,
          { sourceId, itemId: POTION, quantity: 50, character: 'Frog', occurrenceId, waitlist: true },
          h.key(),
        ),
      );
    expect(await waitlist('occ_missing')).toBe('not_found');
    expect(await waitlist(night.id)).toBe('ok');
    h.clock.advance(2 * 86_400);
    await h.bank.housekeeping.expireRaids();
    expect(await waitlist(night.id)).toBe('invalid_transition');
  });
});

describe('TB-RL-07: each raid target counts free stock only from the banks its raid may draw on', () => {
  it("hands out each bank's free stock once, earliest raid first, within each raid's banks", async () => {
    const h = harness();
    await h.seeded('Toads', 50);
    const alt = await h.seeded('Alt', 20);
    const kara = await h.raid('Kara', 40, { inDays: 1, sourceIds: [alt] });
    const gruul = await h.raid('Gruul', 60, { inDays: 2 });
    const target = async (id: string) => (await h.bank.raids.view(admin, id)).targets[0];
    // Kara may only use Alt's 20; Gruul then gets Toads' 50 and nothing left of Alt.
    expect(await target(kara.id)).toMatchObject({ freeAssigned: 20, shortfall: 20 });
    expect(await target(gruul.id)).toMatchObject({ freeAssigned: 50, shortfall: 10 });
  });
});
