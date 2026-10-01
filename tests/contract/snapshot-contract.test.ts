// @TB-DM-03 @TB-BM-06: the TypeScript side of the symmetric contract test. addon/spec does the Lua side.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020';
import { describe, expect, it } from 'vitest';
import {
  type Json,
  type Part,
  TransportError,
  assembleParts,
  canonicalJson,
  decodeSnapshot,
  encodeParts,
  formatPart,
  parseParts,
  utf8Decode,
  utf8Encode,
} from '../../packages/domain/src/index';

const fixtures = join(__dirname, '..', '..', 'contracts', 'fixtures');
const read = (path: string) => readFileSync(join(fixtures, path), 'utf8');
const schema = JSON.parse(readFileSync(join(__dirname, '..', '..', 'contracts', 'schema', 'snapshot.v1.json'), 'utf8'));
const validateSchema = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
const cases = JSON.parse(read('invalid/cases.json')) as {
  now: number;
  cases: Array<{ file: string; stage: 'transport' | 'schema'; code: string }>;
};
const SCHEMA_MESSAGES: Record<string, RegExp> = {
  duplicate_slot: /duplicates slot/,
  future_timestamp: /in the future/,
};

describe('golden fixture', () => {
  const snapshot = JSON.parse(read('golden/snapshot.json'));

  it('canonical JSON gives the golden bytes', () => {
    expect(canonicalJson(snapshot)).toBe(read('golden/snapshot.canonical.json'));
  });

  it('encoding gives the golden parts, each within 1,800 characters', () => {
    const parts = encodeParts(utf8Encode(read('golden/snapshot.canonical.json')), snapshot.snapshotId).map(formatPart);
    expect(`${parts.join('\n\n')}\n`).toBe(read('golden/parts.txt'));
    for (const part of parts) expect(part.length).toBeLessThanOrEqual(1800);
    expect(parts[0]).toContain(`crc32=${read('golden/crc32.txt').trim()}`);
  });

  it('parts pasted in any order rebuild the same snapshot', () => {
    const parts = parseParts(read('golden/parts.txt')).reverse();
    const result = decodeSnapshot(assembleParts(parts), cases.now);
    expect(result).toEqual({ ok: true, snapshot });
  });

  it('survives Discord formatting: code fences, quotes and CRLF', () => {
    const pasted = `here you go\r\n\`\`\`\r\n${read('golden/parts.txt').replace(/\n/g, '\r\n> ')}\`\`\``;
    expect(utf8Decode(assembleParts(parseParts(pasted)))).toBe(read('golden/snapshot.canonical.json'));
  });

  it('agrees with the published JSON Schema', () => {
    expect(validateSchema(snapshot)).toBe(true);
  });
});

describe('invalid fixtures', () => {
  for (const testCase of cases.cases) {
    it(`${testCase.file} is rejected at the ${testCase.stage} stage (${testCase.code})`, () => {
      const text = read(`invalid/${testCase.file}`);
      if (testCase.stage === 'transport') {
        const attempt = () => assembleParts(parseParts(text));
        expect(attempt).toThrow(TransportError);
        try {
          attempt();
        } catch (error) {
          expect((error as TransportError).code).toBe(testCase.code);
        }
        return;
      }
      const result = decodeSnapshot(assembleParts(parseParts(text)), cases.now);
      expect(result.ok).toBe(false);
      if (!result.ok)
        expect(result.issues.map((i) => i.message).join('; ')).toMatch(SCHEMA_MESSAGES[testCase.code] as RegExp);
    });
  }
});

describe('bounds (TB-DM-07)', () => {
  it('rejects a decoded payload above 1 MiB', () => {
    // 800 honest parts stay under 1 MiB, so only a hand-made oversized part can reach this limit.
    const big = utf8Encode(canonicalJson({ pad: 'x'.repeat(1024 * 1024) } as Json));
    const [part] = encodeParts(big.subarray(0, 1269), 'oversize-01');
    const oversized = { ...(part as Part), payload: Buffer.from(big).toString('base64') };
    expect(() => assembleParts([oversized])).toThrow(/too long|exceeds/);
  });

  it('rejects JSON nested deeper than 8', () => {
    const deep = utf8Encode('[[[[[[[[[1]]]]]]]]]');
    expect(decodeSnapshot(deep, cases.now)).toMatchObject({ ok: false });
  });
});
