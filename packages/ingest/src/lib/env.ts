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

/**
 * The outbound identity, required before any request leaves the process
 * (constitution Art. V.4).
 *
 * Absent or contactless is a hard error, not a warning. Article V is one of the
 * three that "no se relajan por conveniencia de implementación", and a request
 * carrying no way to reach us is exactly the thing it forbids. A warning would
 * be ignored on the first busy day.
 */
export function readIngestUserAgent(): string {
  loadRootEnvFile();

  const value = process.env['INGEST_USER_AGENT'];
  if (value === undefined || value.trim() === '') {
    throw new MissingEnvError(['INGEST_USER_AGENT']);
  }

  return validateUserAgent(value, 'INGEST_USER_AGENT');
}

/**
 * The Art. V.4 gate, applied to an identity whatever its origin.
 *
 * Split out of `readIngestUserAgent` on 2026-09-15 so that a value a test
 * supplies passes through **exactly** the same checks as the one production
 * reads from the environment. A seam that skipped validation would let a test
 * go green carrying an identity no source would ever accept — which is the
 * very shape of a test passing for the wrong reason.
 *
 * `origin` names where the value came from, so the message points at the thing
 * that needs fixing rather than at a variable the caller never set.
 */
export function validateUserAgent(value: string, origin: string): string {
  const agent = value.trim();

  if (agent === '') {
    throw new Error(`${origin} is empty, and Art. V.4 requires an identity.`);
  }

  // A contact is the whole point: a URL or an email address someone can use.
  const hasContact = /https?:\/\/\S+|[^\s@]+@[^\s@]+\.[^\s@]+/.test(agent);
  if (!hasContact) {
    throw new Error(
      `${origin} must carry a way to reach us — a URL or an email ` +
        `address (constitution Art. V.4). Got: ${agent}`,
    );
  }

  // `.invalid` is the reserved placeholder TLD, and .env.example ships one.
  // Letting it out would put an unreachable contact in front of every source.
  if (/\.invalid\b/i.test(agent)) {
    throw new Error(
      `${origin} still holds the .env.example placeholder, whose ` +
        `contact does not resolve. Replace it with a real URL or email before ` +
        `any request reaches a source (constitution Art. V.4). Got: ${agent}`,
    );
  }

  return agent;
}
