// @TB-DM-10: the traceability check that fails CI when a capability has no EARS statement and linked scenario.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildTrace } from '../scripts/trace';

describe('traceability (TB-DM-10)', () => {
  const { trace, errors } = buildTrace(join(__dirname, 'fixtures', 'trace'));

  it('links a statement through a built scenario, or a scenario plus a test that names it', () => {
    expect(Object.fromEntries(Object.entries(trace).map(([id, e]) => [id, e.linked]))).toEqual({
      'TB-GM-01': true,
      'TB-GM-02': false,
      'TB-DM-01': true,
      'TB-DM-02': false,
    });
    expect(trace['TB-DM-01']?.tests).toEqual(['tests/named.test.ts']);
  });

  it('reports scenarios naming unknown requirements or none', () => {
    expect(errors).toEqual([
      'features/x.feature:15 names unknown requirement TB-RL-99',
      'features/x.feature:17 has no EARS ID tag',
    ]);
  });

  it('the repository itself has no trace errors', () => {
    expect(buildTrace(join(__dirname, '..')).errors).toEqual([]);
  });
});
