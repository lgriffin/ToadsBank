/**
 * The dependency rules of the service hexagon (spec §4, TB-DM-01):
 *   1. domain imports nothing outside itself;
 *   2. application imports domain and its own port interfaces only;
 *   3. adapters import application ports and domain, never another adapter.
 * Apps are composition roots and may import anything.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

export interface Violation {
  file: string;
  specifier: string;
  rule: string;
}

const IMPORT =
  /(?:^|\n)\s*(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|(?:import|require)\(\s*['"]([^'"]+)['"]\s*\)|(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g;

function files(dir: string): string[] {
  let out: string[] = [];
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of names) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out = out.concat(files(path));
    else if (/\.(ts|tsx|js|mjs)$/.test(name)) out.push(path);
  }
  return out;
}

function specifiers(source: string): string[] {
  const found: string[] = [];
  for (const match of source.matchAll(IMPORT)) found.push((match[1] ?? match[2] ?? match[3]) as string);
  return found;
}

function layerOf(root: string, path: string): { layer: string; base: string } | undefined {
  const rel = relative(root, path).split(sep);
  if (rel[0] !== 'packages') return undefined;
  if (rel[1] === 'domain' || rel[1] === 'application') return { layer: rel[1], base: join(root, 'packages', rel[1]) };
  if (rel[1] === 'adapters' && rel[2])
    return { layer: `adapter:${rel[2]}`, base: join(root, 'packages', 'adapters', rel[2]) };
  return undefined;
}

export function checkArchitecture(root: string): Violation[] {
  const violations: Violation[] = [];
  const sources = [
    ...files(join(root, 'packages', 'domain', 'src')),
    ...files(join(root, 'packages', 'application', 'src')),
    ...readdirSafe(join(root, 'packages', 'adapters')).flatMap((name) =>
      files(join(root, 'packages', 'adapters', name, 'src')),
    ),
  ];
  for (const file of sources) {
    const where = layerOf(root, file);
    if (!where) continue;
    for (const specifier of specifiers(readFileSync(file, 'utf8'))) {
      const rule = breach(root, where, file, specifier);
      if (rule) violations.push({ file: relative(root, file), specifier, rule });
    }
  }
  return violations;
}

function readdirSafe(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function breach(
  root: string,
  where: { layer: string; base: string },
  file: string,
  specifier: string,
): string | undefined {
  if (specifier.startsWith('.')) {
    const target = resolve(dirname(file), specifier);
    const owner = layerOf(root, target);
    if (!target.startsWith(where.base + sep)) {
      return owner ? breach(root, where, file, packageName(owner.layer)) : 'relative import leaves its package';
    }
    return undefined;
  }
  if (where.layer === 'domain') return 'domain imports nothing outside itself';
  if (where.layer === 'application') {
    return specifier === '@toadsbank/domain' ? undefined : 'application imports domain and its own ports only';
  }
  if (specifier.startsWith('@toadsbank/adapter-')) return 'an adapter never imports another adapter';
  return undefined;
}

function packageName(layer: string): string {
  return layer.startsWith('adapter:') ? `@toadsbank/adapter-${layer.slice(8)}` : `@toadsbank/${layer}`;
}
