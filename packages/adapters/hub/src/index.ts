import type { EventSink, OutboxEvent } from '@toadsbank/application';

export interface HubSinkOptions {
  /** The hub's events webhook, e.g. https://hub.example/api/bank/events. */
  url: string;
  serviceToken: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

/**
 * The ManagerNotifier and DashboardPublisher ports for a hub-hosted bank (docs/adr/0002): every outbox event goes to
 * the Toads hub, which DMs managers, posts to channels and edits dashboards through its bot. Any non-2xx answer
 * throws, so the worker retries the event.
 */
export class HubEventSink implements EventSink {
  private readonly fetch: typeof fetch;

  constructor(private readonly options: HubSinkOptions) {
    this.fetch = options.fetch ?? globalThis.fetch;
  }

  async deliver(event: Pick<OutboxEvent, 'id' | 'type' | 'occurredAt' | 'payload'>): Promise<void> {
    const response = await this.fetch(this.options.url, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.options.serviceToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ id: event.id, type: event.type, occurredAt: event.occurredAt, payload: event.payload }),
      signal: AbortSignal.timeout(this.options.timeoutMs ?? 10_000),
    });
    if (!response.ok) throw new Error(`hub answered ${response.status}`);
  }
}

/** Used when no hub URL is configured: events stay in the outbox until one is. */
export class HeldEventSink implements EventSink {
  async deliver(): Promise<void> {
    throw new Error('TOADSBANK_EVENTS_URL is not set; event held');
  }
}
