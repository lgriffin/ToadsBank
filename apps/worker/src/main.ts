import { HeldEventSink, HubEventSink } from '@toadsbank/adapter-hub';
import { PgUnitOfWork, databaseIsReady } from '@toadsbank/adapter-postgres';
// Composition root for the toadsbank-worker image: outbox delivery to the hub, and raid and request expiry.
import { createBank } from '@toadsbank/application';
import pg from 'pg';
import { setting } from '../../api/src/config';
import { randomIds, systemClock } from '../../api/src/ids';

const pool = new pg.Pool({ connectionString: setting('DATABASE_URL'), max: 4 });
const bank = createBank({ uow: new PgUnitOfWork(pool), clock: systemClock, ids: randomIds });
const url = setting('TOADSBANK_EVENTS_URL', '');
const sink = url ? new HubEventSink({ url, serviceToken: setting('TOADSBANK_SERVICE_TOKEN') }) : new HeldEventSink();
const intervalMs = Number(setting('WORKER_INTERVAL_MS', '5000'));
if (!url) console.warn('toadsbank-worker: TOADSBANK_EVENTS_URL is not set, so events stay in the outbox');

let running = true;
async function tick(): Promise<void> {
  if (!(await databaseIsReady(pool))) {
    console.warn('toadsbank-worker: database not ready');
    return;
  }
  const raids = await bank.housekeeping.expireRaids();
  const requests = await bank.housekeeping.expireRequests();
  if (raids.length || requests.length) console.log(`expired ${raids.length} raids, ${requests.length} requests`);
  if (url) {
    const { delivered, failed } = await bank.housekeeping.deliverOutbox(sink);
    if (delivered || failed) console.log(`outbox: ${delivered} delivered, ${failed} failed`);
  }
}

process.on('SIGTERM', () => {
  running = false;
});
while (running) {
  await tick().catch((error) => console.error('toadsbank-worker: tick failed', error));
  await new Promise((resolve) => setTimeout(resolve, intervalMs));
}
await pool.end();
