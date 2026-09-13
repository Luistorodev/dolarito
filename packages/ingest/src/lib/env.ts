import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Environment loading for the ingest package.
 *
 * The repo keeps a single `.env` at the root (gitignored; `.env.example`
 * documents it). In GitHub Actions there is no file at all and the values
 * arrive as real environment variables, so a missing file is not an error.
 */

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const ENV_FILE = resolve(REPO_ROOT, '.env');

let envFileLoaded = false;

/** Loads the root `.env` once, if it exists. Never overwrites a real env var. */
export function loadRootEnvFile(): void {
  if (envFileLoaded) return;
  envFileLoaded = true;
  if (existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);
}

/** Thrown when required variables are absent, listing every one of them. */
export class MissingEnvError extends Error {
  readonly names: readonly string[];

  constructor(names: readonly string[]) {
    super(
      `Missing environment variable(s): ${names.join(', ')}.\n` +
        `Copy .env.example to .env at the repo root and fill them in.\n` +
        `Looked for the file at: ${ENV_FILE}`,
    );
    this.name = 'MissingEnvError';
    this.names = names;
  }
}

export type SupabaseEnv = {
  /** Project URL, e.g. https://abcdefgh.supabase.co */
  readonly url: string;
  /**
   * Write key. Server-side only: the ingest package runs in GitHub Actions and
   * never ships to a browser (constitution Art. V, plan.md 2.3).
   */
  readonly serviceRoleKey: string;
  /**
   * Not used to read or write anything here. It is kept required so the T002
   * criterion ("the three keys are stored") is actually checked, and because
   * T005 needs it for the negative RLS test.
   */
  readonly anonKey: string;
};

/** Reads one variable, recording it as missing instead of throwing early. */
function read(name: string, missing: string[]): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    missing.push(name);
    return '';
  }
  return value;
}

/** Reads the three Supabase variables, reporting all missing ones at once. */
export function readSupabaseEnv(): SupabaseEnv {
  loadRootEnvFile();

  const missing: string[] = [];
  const url = read('SUPABASE_URL', missing);
  const serviceRoleKey = read('SUPABASE_SERVICE_ROLE_KEY', missing);
  const anonKey = read('SUPABASE_ANON_KEY', missing);

  if (missing.length > 0) throw new MissingEnvError(missing);

  return { url, serviceRoleKey, anonKey };
}
