import { describe, expect, it } from 'vitest';
import {
  base64Decode,
  base64Encode,
  canonicalJson,
  crc32Hex,
  encodeParts,
  formatPart,
  missingParts,
  parseParts,
  utf8Encode,
  validateSnapshot,
} from '../src/index';

describe('base64', () => {
  it.each(['', 'f', 'fo', 'foo', 'foob', 'fooba', 'foobar', 'Pötions ✓'])('round-trips %j like Buffer', (text) => {
    const bytes = utf8Encode(text);
    expect(base64Encode(bytes)).toBe(Buffer.from(bytes).toString('base64'));
    expect(base64Decode(base64Encode(bytes))).toEqual(bytes);
  });

  it('rejects characters outside the alphabet', () => {
    expect(() => base64Decode('ab$=')).toThrow(/invalid base64/);
    expect(() => base64Decode('abc')).toThrow(/multiple of 4/);
  });
});

describe('crc32', () => {
  it('matches the IEEE check value', () => {
    expect(crc32Hex(utf8Encode('123456789'))).toBe('cbf43926');
    expect(crc32Hex(new Uint8Array())).toBe('00000000');
  });
});

describe('canonical JSON', () => {
  it('sorts keys and escapes like JSON.stringify', () => {
    expect(canonicalJson({ b: 1, a: ['x\n"y', true, null], c: { z: 'é', y: '\u0001' } })).toBe(
      '{"a":["x\\n\\"y",true,null],"b":1,"c":{"y":"\\u0001","z":"é"}}',
    );
  });

  it('refuses non-integers', () => {
    expect(() => canonicalJson({ a: 1.5 })).toThrow(RangeError);
  });
});

describe('transport', () => {
  it('always emits at least one part, even for an empty payload', () => {
    expect(encodeParts(new Uint8Array(), 'empty-export')).toHaveLength(1);
  });

  it('round-trips a two part export through text', () => {
    const bytes = utf8Encode('x'.repeat(2000));
    const parts = encodeParts(bytes, 'two-parts-01');
    expect(parts.map((p) => p.index)).toEqual([1, 2]);
    expect(parseParts(parts.map(formatPart).join('\n\n'))).toEqual(parts);
  });

  it('reports missing part numbers', () => {
    expect(missingParts(4, [2, 4])).toEqual([1, 3]);
  });

  it('rejects a foreign transport version', () => {
    expect(() => parseParts('TOADSBANK/2 export=abcdefgh part=1/1 crc32=00000000\nAAAA')).toThrow(/version 2/);
  });

  it('rejects a part number out of range', () => {
    expect(() => parseParts('TOADSBANK/1 export=abcdefgh part=3/2 crc32=00000000\nAAAA')).toThrow(/out of range/);
  });
});

describe('validateSnapshot', () => {
  const now = 1_800_000_000;
  const base = () => ({
    schema: 'toadsbank.snapshot',
    schemaVersion: 1,
    snapshotId: 'abcdefgh',
    addon: { version: '0.1.0' },
    client: { flavour: 'tbc', build: '2.5.5', interface: 20505 },
    source: { kind: 'guildBank', guild: 'Toads', realm: 'Spineshatter', region: 'EU' },
    uploader: { name: 'Bankalt', realm: 'Spineshatter' },
    capturedAt: 100,
    completedAt: 110,
    stable: true,
    tabs: [
      {
        index: 1,
        name: 'A',
        status: 'observed',
        capacity: 98,
        observedAt: 105,
        slots: [{ slot: 1, itemId: 5, count: 2 }],
      },
    ],
  });

  it('accepts a minimal snapshot', () => {
    expect(validateSnapshot(base(), now).ok).toBe(true);
  });

  it.each([
    ['an unknown key', (s: ReturnType<typeof base>) => Object.assign(s, { extra: 1 }), /not allowed/],
    [
      'a slot above capacity',
      (s: ReturnType<typeof base>) => Object.assign(s.tabs[0] as object, { capacity: 0 }),
      /integer from 1 to 0/,
    ],
    [
      'slots on an unknown tab',
      (s: ReturnType<typeof base>) => Object.assign(s.tabs[0] as object, { status: 'unknown' }),
      /unless the tab was observed/,
    ],
    [
      'a duplicate tab index',
      (s: ReturnType<typeof base>) => s.tabs.push({ ...(s.tabs[0] as (typeof s.tabs)[0]), slots: [] }),
      /duplicates tab/,
    ],
    [
      'completedAt before capturedAt',
      (s: ReturnType<typeof base>) => Object.assign(s, { completedAt: 99 }),
      /before capturedAt/,
    ],
    [
      'a zero stack',
      (s: ReturnType<typeof base>) => Object.assign((s.tabs[0] as (typeof s.tabs)[0]).slots[0] as object, { count: 0 }),
      /from 1 to 10000/,
    ],
    ['a wrong schema version', (s: ReturnType<typeof base>) => Object.assign(s, { schemaVersion: 2 }), /must be 1/],
    [
      'a bad client flavour',
      (s: ReturnType<typeof base>) => Object.assign(s.client, { flavour: 'TBC!' }),
      /must match/,
    ],
  ])('rejects %s', (_name, mutate, message) => {
    const snapshot = base();
    mutate(snapshot);
    const result = validateSnapshot(snapshot, now);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.map((i) => i.message).join('; ')).toMatch(message);
  });

  it('rejects a non-object', () => {
    expect(validateSnapshot([], now).ok).toBe(false);
  });
});
