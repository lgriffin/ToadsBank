import { MIGRATIONS, migrate } from '@toadsbank/adapter-postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { scratchPool } from './db';

describe('migrate', () => {
  let ctx: Awaited<ReturnType<typeof scratchPool>>;
  beforeAll(async () => {
    ctx = await scratchPool();
  });
  afterAll(async () => ctx.drop());

  it('applies every migration once, even when two migrators race', async () => {
    const [a, b] = await Promise.all([migrate(ctx.pool), migrate(ctx.pool)]);
    expect([...a, ...b].sort()).toEqual(MIGRATIONS.map((m) => m.id).sort());
    expect(await migrate(ctx.pool)).toEqual([]);
  });
});
