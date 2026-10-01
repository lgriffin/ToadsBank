import { utf8Decode } from './canonicalJson';

/** toadsbank.snapshot, schemaVersion 1. contracts/schema/snapshot.v1.json is the published form of these rules. */
export const SNAPSHOT_SCHEMA = 'toadsbank.snapshot';
export const SNAPSHOT_SCHEMA_VERSION = 1;
export const MAX_TABS = 16;
export const MAX_SLOTS_PER_TAB = 256;
export const MAX_STACK = 10_000;
export const MAX_ITEM_ID = 2_147_483_647;
export const MAX_JSON_DEPTH = 8;
/** Allowed clock skew between the uploader's client and the service when checking for future timestamps. */
export const FUTURE_SKEW_SECONDS = 300;

export type TabStatus = 'observed' | 'unknown' | 'unstable';

export interface SnapshotSlot {
  slot: number;
  itemId: number;
  count: number;
  link?: string;
}

export interface SnapshotTab {
  index: number;
  name: string;
  status: TabStatus;
  capacity: number;
  observedAt: number;
  slots: SnapshotSlot[];
}

export interface Snapshot {
  schema: typeof SNAPSHOT_SCHEMA;
  schemaVersion: typeof SNAPSHOT_SCHEMA_VERSION;
  snapshotId: string;
  addon: { version: string };
  client: { flavour: string; build: string; interface: number };
  source: { kind: 'guildBank'; guild: string; realm: string; region: string; configuredSourceId?: string };
  uploader: { name: string; realm: string };
  capturedAt: number;
  completedAt: number;
  stable: boolean;
  money?: number;
  tabs: SnapshotTab[];
}

export interface ValidationIssue {
  path: string;
  message: string;
}

export type ValidationResult = { ok: true; snapshot: Snapshot } | { ok: false; issues: ValidationIssue[] };

/** Nesting depth of a JSON text, ignoring brackets inside strings; checked before JSON.parse (TB-DM-07). */
export function jsonDepth(text: string): number {
  let depth = 0;
  let max = 0;
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (inString) {
      if (char === '\\') i++;
      else if (char === '"') inString = false;
    } else if (char === '"') inString = true;
    else if (char === '{' || char === '[') max = Math.max(max, ++depth);
    else if (char === '}' || char === ']') depth--;
  }
  return max;
}

/** Decode and validate snapshot bytes. `now` is epoch seconds, for the future-timestamp rule. */
export function decodeSnapshot(bytes: Uint8Array, now: number): ValidationResult {
  let text: string;
  try {
    text = utf8Decode(bytes);
  } catch {
    return { ok: false, issues: [{ path: '', message: 'payload is not valid UTF-8' }] };
  }
  if (jsonDepth(text) > MAX_JSON_DEPTH) {
    return { ok: false, issues: [{ path: '', message: `JSON nests deeper than ${MAX_JSON_DEPTH}` }] };
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, issues: [{ path: '', message: 'payload is not valid JSON' }] };
  }
  return validateSnapshot(value, now);
}

class Checker {
  readonly issues: ValidationIssue[] = [];

  fail(path: string, message: string): void {
    if (this.issues.length < 50) this.issues.push({ path, message });
  }

  object(
    value: unknown,
    path: string,
    keys: { required: string[]; optional?: string[] },
  ): value is Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      this.fail(path, 'must be an object');
      return false;
    }
    const allowed = new Set([...keys.required, ...(keys.optional ?? [])]);
    for (const key of Object.keys(value)) if (!allowed.has(key)) this.fail(`${path}/${key}`, 'is not allowed');
    for (const key of keys.required) if (!(key in value)) this.fail(`${path}/${key}`, 'is required');
    return true;
  }

  int(value: unknown, path: string, min: number, max: number): value is number {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
      this.fail(path, `must be an integer from ${min} to ${max}`);
      return false;
    }
    return true;
  }

  string(value: unknown, path: string, min: number, max: number, pattern?: RegExp): value is string {
    if (typeof value !== 'string' || value.length < min || value.length > max || (pattern && !pattern.test(value))) {
      this.fail(path, pattern ? `must match ${pattern.source}` : `must be a string of ${min} to ${max} characters`);
      return false;
    }
    return true;
  }
}

const MAX_TIME = 4_102_444_800; // 2100-01-01

export function validateSnapshot(value: unknown, now: number): ValidationResult {
  const c = new Checker();
  if (
    !c.object(value, '', {
      required: [
        'schema',
        'schemaVersion',
        'snapshotId',
        'addon',
        'client',
        'source',
        'uploader',
        'capturedAt',
        'completedAt',
        'stable',
        'tabs',
      ],
      optional: ['money'],
    })
  ) {
    return { ok: false, issues: c.issues };
  }
  if (value.schema !== SNAPSHOT_SCHEMA) c.fail('/schema', `must be ${SNAPSHOT_SCHEMA}`);
  if (value.schemaVersion !== SNAPSHOT_SCHEMA_VERSION) c.fail('/schemaVersion', `must be ${SNAPSHOT_SCHEMA_VERSION}`);
  c.string(value.snapshotId, '/snapshotId', 8, 48, /^[A-Za-z0-9-]{8,48}$/);
  if (c.object(value.addon, '/addon', { required: ['version'] }))
    c.string(value.addon.version, '/addon/version', 1, 32);
  if (c.object(value.client, '/client', { required: ['flavour', 'build', 'interface'] })) {
    c.string(value.client.flavour, '/client/flavour', 1, 24, /^[a-z0-9_]{1,24}$/);
    c.string(value.client.build, '/client/build', 0, 32);
    c.int(value.client.interface, '/client/interface', 0, 9_999_999);
  }
  if (
    c.object(value.source, '/source', {
      required: ['kind', 'guild', 'realm', 'region'],
      optional: ['configuredSourceId'],
    })
  ) {
    if (value.source.kind !== 'guildBank') c.fail('/source/kind', 'must be guildBank');
    c.string(value.source.guild, '/source/guild', 1, 64);
    c.string(value.source.realm, '/source/realm', 1, 64);
    c.string(value.source.region, '/source/region', 0, 8);
    if (value.source.configuredSourceId !== undefined)
      c.string(value.source.configuredSourceId, '/source/configuredSourceId', 1, 64);
  }
  if (c.object(value.uploader, '/uploader', { required: ['name', 'realm'] })) {
    c.string(value.uploader.name, '/uploader/name', 1, 24);
    c.string(value.uploader.realm, '/uploader/realm', 1, 64);
  }
  const timesOk =
    c.int(value.capturedAt, '/capturedAt', 0, MAX_TIME) && c.int(value.completedAt, '/completedAt', 0, MAX_TIME);
  if (timesOk) {
    const capturedAt = value.capturedAt as number;
    const completedAt = value.completedAt as number;
    if (completedAt < capturedAt) c.fail('/completedAt', 'must not be before capturedAt');
    if (completedAt > now + FUTURE_SKEW_SECONDS) c.fail('/completedAt', 'is in the future');
  }
  if (typeof value.stable !== 'boolean') c.fail('/stable', 'must be a boolean');
  if (value.money !== undefined) c.int(value.money, '/money', 0, Number.MAX_SAFE_INTEGER);
  checkTabs(c, value.tabs, now);
  return c.issues.length === 0 ? { ok: true, snapshot: value as unknown as Snapshot } : { ok: false, issues: c.issues };
}

function checkTabs(c: Checker, tabs: unknown, now: number): void {
  if (!Array.isArray(tabs) || tabs.length > MAX_TABS) {
    c.fail('/tabs', `must be an array of at most ${MAX_TABS} tabs`);
    return;
  }
  const indices = new Set<number>();
  tabs.forEach((tab: unknown, t) => {
    const path = `/tabs/${t}`;
    if (!c.object(tab, path, { required: ['index', 'name', 'status', 'capacity', 'observedAt', 'slots'] })) return;
    if (c.int(tab.index, `${path}/index`, 1, MAX_TABS)) {
      if (indices.has(tab.index)) c.fail(`${path}/index`, `duplicates tab ${tab.index}`);
      indices.add(tab.index);
    }
    c.string(tab.name, `${path}/name`, 0, 64);
    if (tab.status !== 'observed' && tab.status !== 'unknown' && tab.status !== 'unstable') {
      c.fail(`${path}/status`, 'must be observed, unknown or unstable');
    }
    const capacity = c.int(tab.capacity, `${path}/capacity`, 0, MAX_SLOTS_PER_TAB) ? tab.capacity : MAX_SLOTS_PER_TAB;
    if (
      c.int(tab.observedAt, `${path}/observedAt`, 0, MAX_TIME) &&
      (tab.observedAt as number) > now + FUTURE_SKEW_SECONDS
    ) {
      c.fail(`${path}/observedAt`, 'is in the future');
    }
    if (!Array.isArray(tab.slots) || tab.slots.length > MAX_SLOTS_PER_TAB) {
      c.fail(`${path}/slots`, `must be an array of at most ${MAX_SLOTS_PER_TAB} slots`);
      return;
    }
    if (tab.status !== 'observed' && tab.slots.length > 0)
      c.fail(`${path}/slots`, 'must be empty unless the tab was observed');
    const slots = new Set<number>();
    tab.slots.forEach((slot: unknown, s) => {
      const slotPath = `${path}/slots/${s}`;
      if (!c.object(slot, slotPath, { required: ['slot', 'itemId', 'count'], optional: ['link'] })) return;
      if (c.int(slot.slot, `${slotPath}/slot`, 1, capacity as number)) {
        if (slots.has(slot.slot)) c.fail(`${slotPath}/slot`, `duplicates slot ${slot.slot}`);
        slots.add(slot.slot);
      }
      c.int(slot.itemId, `${slotPath}/itemId`, 1, MAX_ITEM_ID);
      c.int(slot.count, `${slotPath}/count`, 1, MAX_STACK);
      if (slot.link !== undefined) c.string(slot.link, `${slotPath}/link`, 1, 512);
    });
  });
}
