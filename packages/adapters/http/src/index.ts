import { Hono } from 'hono';

export interface HealthProbe {
  /** True when the service's real dependency (the database, migrated) answers. */
  ready(): Promise<boolean>;
}

export function createApp(health: HealthProbe): Hono {
  const app = new Hono();
  app.get('/health', async (c) => {
    const ok = await health.ready();
    return c.json({ ok }, ok ? 200 : 503);
  });
  return app;
}
