/**
 * The one way out to the network (T006c).
 *
 * No adapter calls `fetch`. The identity we present, how long we wait, and how
 * we behave when a source pushes back are decisions the project makes once,
 * here, not eight times across eight files.
 *
 * ---
 *
 * ## Refresh cadence each source declares (Art. V.3)
 *
 * V.3 says never to poll faster than the source refreshes itself. The ingest
 * cron runs every 15 minutes (plan.md §4), and the table below is what that
 * figure has to be conservative against.
 *
 * | Source | Declared cadence | Where that comes from |
 * |---|---|---|
 * | `trm` (datos.gov.co) | Daily. Each row carries `vigenciadesde`/`vigenciahasta`, and one rate governs until the next takes over — across weekends and holidays. | The data itself: the validity window is a field, not an inference (plan.md §3.1, T010). |
 * | `mid_market` (Yahoo `USDCOP=X`) | Down to 1 minute. | plan.md §3.1. |
 * | `mid_market` fallback (`open.er-api.com`) | Daily. The response states its own next update. | plan.md §3.1 calls it "diaria"; the response field is the source's own declaration. |
 *
 * **Everything below this line is NOT yet verified against the source, and must
 * be before its adapter ships.** No number is guessed here: where the cadence is
 * unknown it says unknown, because a made-up interval is exactly the kind of
 * invented datum Art. I forbids, and it would be used to justify our polling
 * rate.
 *
 * | Source | Status |
 * |---|---|
 * | `bitso`, `buda`, `binance_p2p`, `eldorado` | Order books and P2P listings. They change continuously rather than on a published cycle, so what constrains us is the documented rate limit, not a refresh interval. **Rate limits unread.** Each adapter task (T012, T014, T015, T016) must record the real figure here. |
 * | `wise` | Comparison endpoint. **Cadence and rate limit unread** (T017). |
 *
 * 15 minutes is comfortably conservative against every cadence in the first
 * table — it is 96 polls a day against sources that change daily, and the one
 * minute-granularity source is the only one where our cadence is the coarser of
 * the two. It cannot yet be called conservative against the second table,
 * because there is nothing there to compare it to.
 */

import { readIngestUserAgent } from './lib/env.ts';

/** Art. V.4: 10 seconds, per attempt, not per call. */
export const DEFAULT_TIMEOUT_MS = 10_000;

/** One initial try plus three retries. */
export const DEFAULT_MAX_ATTEMPTS = 4;

export const DEFAULT_BASE_DELAY_MS = 1_000;

/** Never sleep longer than this, however long `Retry-After` asks for. */
const MAX_DELAY_MS = 60_000;

export type HttpOptions = {
  headers?: Record<string, string>;
  timeoutMs?: number;
  maxAttempts?: number;
  baseDelayMs?: number;

  // --- Seams for tests. Production never passes these.
  fetchImpl?: typeof fetch;
  /** Receives the delay actually chosen, so a test can assert the schedule. */
  sleep?: (ms: number) => Promise<void>;
  /** Jitter source, in [0, 1). 0.5 means no jitter. */
  random?: () => number;
};

export class HttpError extends Error {
  readonly url: string;
  readonly status: number | undefined;
  readonly attempts: number;

  constructor(message: string, url: string, status: number | undefined, attempts: number) {
    super(message);
    this.name = 'HttpError';
    this.url = url;
    this.status = status;
    this.attempts = attempts;
  }
}

/**
 * Art. V.5: a source answering 429 or 5xx is left to rest.
 *
 * 504 is in range and deliberately so. Supabase returns it while a paused
 * project wakes up, and treating that as a dead source would make the first
 * cycle after any idle period count as an outage.
 */
export function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

/**
 * `Retry-After`, when the source sends one, in seconds or as an HTTP date.
 *
 * The source asking for a specific wait outranks our own schedule — that is the
 * source telling us its cadence, which is the whole of Art. V.3.
 */
export function parseRetryAfter(header: string | null, nowMs: number): number | undefined {
  if (header === null) return undefined;

  const seconds = Number(header.trim());
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1_000, MAX_DELAY_MS);
  }

  const date = Date.parse(header);
  if (!Number.isNaN(date)) {
    return Math.min(Math.max(date - nowMs, 0), MAX_DELAY_MS);
  }

  return undefined;
}

/** Exponential: base, then double each attempt, with ±20% jitter. */
export function backoffDelay(attempt: number, baseDelayMs: number, random: () => number): number {
  const exponential = baseDelayMs * 2 ** (attempt - 1);
  const jitter = 0.8 + 0.4 * random();
  return Math.min(Math.round(exponential * jitter), MAX_DELAY_MS);
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Performs one request, retrying on 429 and 5xx with exponential backoff.
 *
 * Returns the response only when it is ok. Anything else has already exhausted
 * its retries and throws — which is what the orchestrator turns into a
 * `sources_failed` entry, with no row in `quotes` (Art. I.2).
 */
export async function httpRequest(url: string, options: HttpOptions = {}): Promise<Response> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;

  const headers: Record<string, string> = {
    'User-Agent': readIngestUserAgent(),
    Accept: 'application/json',
    ...options.headers,
  };

  let lastStatus: number | undefined;
  let lastReason = '';

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let response: Response | undefined;

    try {
      response = await fetchImpl(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
    } catch (error) {
      // A timeout or a transport failure. Same treatment as a 5xx: rest, retry.
      lastStatus = undefined;
      lastReason = error instanceof Error ? error.message : String(error);

      if (attempt === maxAttempts) break;
      await sleep(backoffDelay(attempt, baseDelayMs, random));
      continue;
    }

    if (response.ok) return response;

    lastStatus = response.status;
    lastReason = `HTTP ${response.status}`;

    if (!isRetryableStatus(response.status)) {
      throw new HttpError(`${url} -> ${lastReason}`, url, response.status, attempt);
    }

    if (attempt === maxAttempts) break;

    const requested = parseRetryAfter(response.headers.get('retry-after'), Date.now());
    await sleep(requested ?? backoffDelay(attempt, baseDelayMs, random));
  }

  throw new HttpError(
    `${url} -> ${lastReason} after ${maxAttempts} attempt(s)`,
    url,
    lastStatus,
    maxAttempts,
  );
}

/** Art. V.1: JSON endpoints only. No HTML is ever parsed. */
export async function httpJson<T>(url: string, options: HttpOptions = {}): Promise<T> {
  const response = await httpRequest(url, options);
  return (await response.json()) as T;
}
