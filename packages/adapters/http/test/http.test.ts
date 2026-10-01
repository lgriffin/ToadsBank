import { ManualClock, MemoryUnitOfWork, SequentialIds, createBank } from '@toadsbank/application';
import { type Json, canonicalJson, encodeParts, formatPart, utf8Encode } from '@toadsbank/domain';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/index';

const TOKEN = ['test', 'service', 'token'].join('-');
const now = 1_790_800_000;

function setup() {
  const bank = createBank({ uow: new MemoryUnitOfWork(), clock: new ManualClock(now), ids: new SequentialIds() });
  const app = createApp({ bank, health: { ready: async () => true }, serviceToken: TOKEN });
  const call = (
    method: string,
    path: string,
    init: { body?: unknown; member?: string; roles?: string; key?: string; token?: string } = {},
  ) =>
    app.request(path, {
      method,
      headers: {
        authorization: `Bearer ${init.token ?? TOKEN}`,
        'x-toads-member': init.member ?? '1',
        'x-toads-name': encodeURIComponent('Lé igh'),
        'x-toads-roles': init.roles ?? 'member,officer,admin',
        'content-type': 'application/json',
        ...(init.key ? { 'idempotency-key': init.key } : {}),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  return { app, call };
}

const snapshot = {
  schema: 'toadsbank.snapshot',
  schemaVersion: 1,
  snapshotId: 'http-test-0001',
  addon: { version: '0.1.0' },
  client: { flavour: 'tbc', build: '2.5.5', interface: 20505 },
  source: { kind: 'guildBank', guild: 'Toads', realm: 'Spineshatter', region: 'EU' },
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
      slots: [{ slot: 1, itemId: 22832, count: 20, link: '|Hitem:22832|h[Super Mana Potion]|h' }],
    },
  ],
};
const text = encodeParts(utf8Encode(canonicalJson(snapshot as Json)), snapshot.snapshotId)
  .map(formatPart)
  .join('\n\n');

describe('HTTP adapter', () => {
  it('answers health without auth', async () => {
    const { app } = setup();
    expect(await (await app.request('/health')).json()).toEqual({ ok: true });
  });

  it('refuses a wrong token or a missing member', async () => {
    const { call } = setup();
    expect((await call('GET', '/v1/sources', { token: 'nope' })).status).toBe(401);
    expect((await call('GET', '/v1/sources', { member: 'abc' })).status).toBe(401);
  });

  it('imports, browses and requests end to end', async () => {
    const { call } = setup();
    const session = (await (await call('POST', '/v1/imports')).json()) as { id: string };
    const progress = await (await call('POST', `/v1/imports/${session.id}/parts`, { body: { text } })).json();
    expect(progress).toMatchObject({ complete: true, missing: [] });
    const preview = await (await call('GET', `/v1/imports/${session.id}/preview`)).json();
    expect(preview).toMatchObject({ snapshotId: 'http-test-0001', matchedSource: null });
    expect((await call('POST', `/v1/imports/${session.id}/accept`)).status).toBe(400);
    const receipt = (await (await call('POST', `/v1/imports/${session.id}/accept`, { key: 'k1' })).json()) as {
      sourceId: string;
    };
    expect(receipt).toMatchObject({ tabsUpdated: [1], duplicate: false });

    const replica = (await (await call('GET', `/v1/sources/${receipt.sourceId}/replica`)).json()) as {
      tabs: Array<{ slots: unknown[] }>;
    };
    expect(replica.tabs[0]?.slots[0]).toMatchObject({ name: 'Super Mana Potion', count: 20 });

    const created = await call('POST', '/v1/requests', {
      member: '2',
      roles: 'member',
      key: 'r1',
      body: { sourceId: receipt.sourceId, itemId: 22832, quantity: 25, character: 'Frog' },
    });
    expect(created.status).toBe(409);
    expect(await created.json()).toMatchObject({
      error: { code: 'insufficient_stock', details: { available: 20, canWaitlist: true } },
    });

    const ok = await call('POST', '/v1/requests', {
      member: '2',
      roles: 'member',
      key: 'r2',
      body: { sourceId: receipt.sourceId, itemId: 22832, quantity: 5, character: 'Frog' },
    });
    expect(ok.status).toBe(201);
    const request = (await ok.json()) as { id: string; revision: number; memberName: string };
    expect(request.memberName).toBe('Lé igh');
    const queue = (await (await call('GET', '/v1/requests?scope=queue')).json()) as unknown[];
    expect(queue).toHaveLength(1);

    const stale = await call('POST', `/v1/requests/${request.id}/approve`, {
      key: 'a1',
      body: { expectedRevision: 99 },
    });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ error: { code: 'stale_revision', current: { status: 'reserved' } } });

    const inventory = (await (await call('GET', '/v1/inventory?q=mana', { member: '2', roles: 'member' })).json()) as {
      items: unknown[];
    };
    expect(inventory.items[0]).toMatchObject({ observed: 20, directReserved: 5, available: 15 });
  });

  it('maps a bad body to 400 and an unknown request to 404', async () => {
    const { call, app } = setup();
    const res = await app.request('/v1/requests', {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}`, 'x-toads-member': '1', 'idempotency-key': 'x' },
      body: 'not json',
    });
    expect(res.status).toBe(400);
    expect(
      (await call('POST', '/v1/requests/req_404/cancel', { key: 'c', body: { expectedRevision: 1 } })).status,
    ).toBe(404);
    expect((await call('GET', '/v1/requests?scope=everyone')).status).toBe(400);
  });

  it('hides a 500 behind a generic message', async () => {
    const bank = createBank({ uow: new MemoryUnitOfWork(), clock: new ManualClock(now), ids: new SequentialIds() });
    bank.inventory.sources = async () => {
      throw new Error('database exploded with secrets');
    };
    const seen: unknown[] = [];
    const app = createApp({
      bank,
      health: { ready: async () => false },
      serviceToken: TOKEN,
      onError: (e) => seen.push(e),
    });
    const res = await app.request('/v1/sources', {
      headers: { authorization: `Bearer ${TOKEN}`, 'x-toads-member': '1' },
    });
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain('secrets');
    expect(seen).toHaveLength(1);
    expect((await app.request('/health')).status).toBe(503);
  });
});
