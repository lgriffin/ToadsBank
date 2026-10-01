// @TB-DM-01: the architecture test that guards the hexagon's dependency rules on every pull request.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkArchitecture } from './architecture';

describe('hexagon dependency rules (TB-DM-01)', () => {
  it('the source tree has no violations', () => {
    expect(checkArchitecture(join(__dirname, '..'))).toEqual([]);
  });

  it('catches every kind of deliberate breach', () => {
    const rules = checkArchitecture(join(__dirname, 'fixtures', 'arch-breach')).map(
      (v) => `${v.file} -> ${v.specifier}`,
    );
    expect(rules.sort()).toEqual(
      [
        'packages/adapters/http/src/routes.ts -> ../../postgres/src/repo',
        'packages/adapters/http/src/routes.ts -> @toadsbank/adapter-postgres',
        'packages/application/src/useCase.ts -> @toadsbank/adapter-postgres',
        'packages/application/src/useCase.ts -> pg',
        'packages/domain/src/entity.ts -> ../../application/src/useCase',
        'packages/domain/src/entity.ts -> discord.js',
        'packages/domain/src/entity.ts -> node:fs',
      ].sort(),
    );
  });
});
