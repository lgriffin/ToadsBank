// Composition root for the toadsbank-worker image: outbox delivery, DM retries and expiry arrive with Slice 1-3.
import { databaseIsReady } from '@toadsbank/adapter-postgres';
import pg from 'pg';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const tick = async () => {
  if (!(await databaseIsReady(pool))) console.warn('toadsbank-worker: database not ready');
};
setInterval(tick, 5000);
await tick();
