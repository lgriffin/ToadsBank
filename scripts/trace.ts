/**
 * Traceability: every EARS statement in requirements/*.ears should have a Gherkin scenario tagged with its ID and a
 * test behind it (TB-DM-10). A scenario's test is Cucumber itself, unless it is tagged @verified-elsewhere, in which
 * case some test file outside Cucumber must name the ID.
 *
 *   --write  regenerate requirements/trace.json
 *   --check  fail if trace.json is stale, a scenario names an unknown ID, or more statements are unlinked than the
 *            ratchet in requirements/trace-ratchet.json allows (lower the ratchet as statements get linked)
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

const ID = /\bTB-(?:GM|RL|BM|DM)-\d\d\b/g;
const TAG = /^@TB-(?:GM|RL|BM|DM)-\d\d$/;

export interface Entry {
  statement: string;
  scenarios: string[];
  tests: string[];
  linked: boolean;
}

function walk(dir: string, accept: (path: string) => boolean, out: string[] = []): string[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of names) {
    if (name === 'node_modules' || name === 'fixtures' || name.startsWith('.')) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, accept, out);
    else if (accept(path)) out.push(path);
  }
  return out;
}

export function buildTrace(root: string): { trace: Record<string, Entry>; errors: string[] } {
  const trace: Record<string, Entry> = {};
  const errors: string[] = [];
  for (const file of walk(join(root, 'requirements'), (p) => p.endsWith('.ears'))) {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      if (!line.startsWith('TB-')) continue;
      const [id, , statement] = line.split('|').map((s) => s.trim()) as [string, string, string];
      if (trace[id]) errors.push(`${id} is defined twice`);
      trace[id] = { statement, scenarios: [], tests: [], linked: false };
    }
  }
  const elsewhere = new Set<string>();
  const built = new Set<string>();
  for (const file of walk(join(root, 'features'), (p) => p.endsWith('.feature'))) {
    let tags: string[] = [];
    readFileSync(file, 'utf8')
      .split('\n')
      .forEach((line, n) => {
        const text = line.trim();
        if (text.startsWith('@')) tags.push(...text.split(/\s+/));
        else if (/^Scenario( Outline)?:/.test(text)) {
          const ids = tags.filter((t) => TAG.test(t)).map((t) => t.slice(1));
          if (ids.length === 0) errors.push(`${relative(root, file)}:${n + 1} has no EARS ID tag`);
          for (const id of ids) {
            const entry = trace[id];
            if (!entry) {
              errors.push(`${relative(root, file)}:${n + 1} names unknown requirement ${id}`);
              continue;
            }
            entry.scenarios.push(`${relative(root, file)}:${n + 1}`);
            if (!tags.includes('@pending')) built.add(id);
            if (tags.includes('@verified-elsewhere')) elsewhere.add(id);
          }
          tags = [];
        } else if (text !== '' && !text.startsWith('#')) tags = [];
      });
  }
  const testFiles = [
    ...walk(join(root, 'packages'), (p) => /\.(test|steps)\.ts$/.test(p)),
    ...walk(join(root, 'apps'), (p) => /\.test\.ts$/.test(p)),
    ...walk(join(root, 'tests'), (p) => /\.test\.ts$/.test(p)),
    ...walk(join(root, 'addon'), (p) => /_spec\.lua$/.test(p)),
  ];
  for (const file of testFiles) {
    for (const id of new Set(readFileSync(file, 'utf8').match(ID) ?? [])) trace[id]?.tests.push(relative(root, file));
  }
  for (const [id, entry] of Object.entries(trace)) {
    entry.tests.sort();
    entry.linked = built.has(id) && (!elsewhere.has(id) || entry.tests.length > 0);
  }
  return { trace, errors };
}

function main(root: string): void {
  const { trace, errors } = buildTrace(root);
  const text = `${JSON.stringify(trace, null, 2)}\n`;
  const tracePath = join(root, 'requirements', 'trace.json');
  const unlinked = Object.entries(trace)
    .filter(([, e]) => !e.linked)
    .map(([id]) => id);
  const ratchet = JSON.parse(readFileSync(join(root, 'requirements', 'trace-ratchet.json'), 'utf8')) as {
    maxUnlinked: number;
  };
  console.log(`${Object.keys(trace).length} statements, ${unlinked.length} unlinked: ${unlinked.join(' ')}`);
  if (process.argv.includes('--write')) {
    writeFileSync(tracePath, text);
    return;
  }
  let stale = false;
  try {
    stale = readFileSync(tracePath, 'utf8') !== text;
  } catch {
    stale = true;
  }
  if (stale) errors.push('requirements/trace.json is stale: run npm run trace:write');
  if (unlinked.length > ratchet.maxUnlinked) {
    errors.push(`${unlinked.length} unlinked statements exceeds the ratchet of ${ratchet.maxUnlinked}`);
  } else if (unlinked.length < ratchet.maxUnlinked) {
    errors.push(
      `only ${unlinked.length} statements are unlinked now: lower maxUnlinked in requirements/trace-ratchet.json`,
    );
  }
  for (const error of errors) console.error(error);
  if (errors.length > 0) process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(join(import.meta.dirname, '..'));
