// Composition root for the toadsbank-api image: `node main.mjs` serves the API, `node main.mjs migrate` migrates.
import { serve } from '@hono/node-server';
import { createApp } from '@toadsbank/adapter-http';
import { databaseIsReady, migrate } from '@toadsbank/adapter-postgres';
import pg from 'pg';
import { setting } from './config';

const pool = new pg.Pool({ connectionString: setting('DATABASE_URL'), max: Number(setting('DATABASE_POOL', '10')) });

if (process.argv[2] === 'migrate') {
  const applied = await migrate(pool);
  console.log(applied.length ? `applied ${applied.join(', ')}` : 'schema is up to date');
  await pool.end();
} else {
  const app = createApp({ ready: () => databaseIsReady(pool) });
  const port = Number(setting('PORT', '8080'));
  serve({ fetch: app.fetch, port }, () => console.log(`toadsbank-api listening on ${port}`));
}
