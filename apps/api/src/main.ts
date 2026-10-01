// Composition root for the toadsbank-api image.
//   node main.mjs           serve the HTTP API
//   node main.mjs migrate   apply schema migrations, then exit
//   node main.mjs seed      seed the Toads demo bank (dev only), then exit
import { serve } from '@hono/node-server';
import { createApp } from '@toadsbank/adapter-http';
import { PgUnitOfWork, databaseIsReady, migrate } from '@toadsbank/adapter-postgres';
import { createBank } from '@toadsbank/application';
import pg from 'pg';
import { setting } from './config';
import { randomIds, systemClock } from './ids';
import { seed } from './seed';

const pool = new pg.Pool({ connectionString: setting('DATABASE_URL'), max: Number(setting('DATABASE_POOL', '10')) });
const bank = createBank({ uow: new PgUnitOfWork(pool), clock: systemClock, ids: randomIds });
const command = process.argv[2] ?? 'serve';

if (command === 'migrate') {
  const applied = await migrate(pool);
  console.log(applied.length ? `applied ${applied.join(', ')}` : 'schema is up to date');
  await pool.end();
} else if (command === 'seed') {
  console.log(await seed(bank, systemClock.now()));
  await pool.end();
} else {
  const app = createApp({
    bank,
    health: { ready: () => databaseIsReady(pool) },
    serviceToken: setting('TOADSBANK_SERVICE_TOKEN'),
    onError: (error) => console.error('toadsbank-api: unexpected error', error),
  });
  const port = Number(setting('PORT', '8080'));
  const server = serve({ fetch: app.fetch, port }, () => console.log(`toadsbank-api listening on ${port}`));
  const stop = () => server.close(() => void pool.end());
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}
