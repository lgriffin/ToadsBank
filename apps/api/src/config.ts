import { readFileSync } from 'node:fs';

/** Read a setting from the environment, or from the file named by <NAME>_FILE (Docker secrets). */
export function setting(name: string, fallback?: string): string {
  const file = process.env[`${name}_FILE`];
  if (file) return readFileSync(file, 'utf8').trim();
  const value = process.env[name] ?? fallback;
  if (value === undefined) throw new Error(`${name} (or ${name}_FILE) is required`);
  return value;
}
