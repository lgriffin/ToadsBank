import { randomUUID } from 'node:crypto';
import type { IdGenerator } from '@toadsbank/application';

export const randomIds: IdGenerator = { next: (prefix) => `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 20)}` };
export const systemClock = { now: () => Math.floor(Date.now() / 1000) };
