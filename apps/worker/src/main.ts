// Composition root for the toadsbank-worker image: outbox delivery, DM retries and expiry arrive with the core.
import { databaseIsReady } from '@toadsbank/adapter-postgres';
import pg from 'pg';
import { setting } from '../../api/src/config';

const pool = new pg.Pool({ connectionString: setting('DATABASE_URL'), max: 2 });
const tick = async () => {
  if (!(await databaseIsReady(pool))) console.warn('toadsbank-worker: database not ready');
};
setInterval(tick, 5000);
await tick();
