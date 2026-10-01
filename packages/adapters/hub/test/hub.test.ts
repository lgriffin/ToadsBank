import { describe, expect, it } from 'vitest';
import { HeldEventSink, HubEventSink } from '../src/index';

const event = { id: 'evt_1', type: 'request.created' as const, occurredAt: 1, payload: { a: 1 } };

describe('HubEventSink', () => {
  it('posts the event with the service token', async () => {
    const calls: Array<[string, RequestInit]> = [];
    const sink = new HubEventSink({
      url: 'https://hub.test/api/bank/events',
      serviceToken: 'tok',
      fetch: (async (url: string, init: RequestInit) => {
        calls.push([url, init]);
        return new Response(null, { status: 202 });
      }) as unknown as typeof fetch,
    });
    await sink.deliver(event);
    expect(calls[0]?.[0]).toBe('https://hub.test/api/bank/events');
    expect((calls[0]?.[1].headers as Record<string, string>).authorization).toBe('Bearer tok');
    expect(JSON.parse(calls[0]?.[1].body as string)).toEqual(event);
  });

  it('throws on a non-2xx answer so the worker retries', async () => {
    const sink = new HubEventSink({
      url: 'https://hub.test',
      serviceToken: 't',
      fetch: (async () => new Response(null, { status: 503 })) as unknown as typeof fetch,
    });
    await expect(sink.deliver(event)).rejects.toThrow(/503/);
    await expect(new HeldEventSink().deliver()).rejects.toThrow(/not set/);
  });
});
