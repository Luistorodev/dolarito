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
 * | `trm` (datos.gov.co) | Daily, and each record states its own validity window in `vigenciadesde`/`vigenciahasta` — one rate governs until the next takes over, across weekends and holidays. Observed 2026-09-13: the live record ran Sat 12 → Mon 14, three days. | The data itself: the window is a field, not an inference (T010). |
 * | `mid_market` (Yahoo `USDCOP=X`) | **`Cache-Control: public, max-age=10`** — Yahoo considers its own answer fresh for 10 seconds. Observed on a live 200, 2026-09-13. | The response header: the source stating its own refresh interval. |
 * | `mid_market` fallback (`open.er-api.com`) | **`Cache-Control: public, max-age=3600`**, and the body carries `time_next_update_unix` — observed 2026-09-13 pointing ~24h ahead. Daily, declared twice over. | Both the header and a field in the payload. |
 *
 * **Everything below this line is NOT yet verified against the source, and must
 * be before its adapter ships.** No number is guessed here: where the cadence is
 * unknown it says unknown, because a made-up interval is exactly the kind of
 * invented datum Art. I forbids, and it would be used to justify our polling
 * rate.
 *
 * | Source | Status |
 * |---|---|
 * | `trm` (datos.gov.co) | **No rate limit is stated in the response.** Checked 2026-09-13 on a live 200: the only `x-soda2-*` headers describe the dataset (fields, types, last modified); there is no `X-RateLimit-*`, `Retry-After` or `Cache-Control` of any kind. Socrata's platform documents an app-token scheme under which unauthenticated callers share a throttled pool per IP, but **the numeric limit was not verified and is not asserted here**. One request per 15 minutes against a dataset that changes once a day is not close to any plausible ceiling, but that is an argument from the cadence, not from a published figure. |
 * | `bitso` | **No rate limit is stated in the response.** Checked 2026-09-13 on a live 200 of `/v3/ticker/?book=usdt_cop`: no `X-RateLimit-*`, no `Retry-After`, no `Cache-Control`. Bitso documents per-endpoint limits in its API reference, but **the figure was not read from the wire and is not asserted here**. The ticker carries its own `created_at`, which on that capture was seconds old — a continuously updating book, so there is no refresh cycle to be slower than, only a ceiling we have not measured. One request per 15 minutes. |
 * | `dolarapp` | **`Cache-Control: no-cache, no-store, max-age=0, must-revalidate`** plus `Expires: 0`, observed 2026-09-13 on a live 200. The source is telling clients not to cache at all — every read is meant to be live — so there is no refresh interval to be slower than. No rate-limit header of any kind either. **No published ceiling was read from the wire.** |
 * | `buda` | **`Cache-Control: max-age=2, public, s-maxage=2`**, observed 2026-09-13 on a live 200: Buda considers its own ticker fresh for 2 seconds. We poll 450x slower. No `X-RateLimit-*` or `Retry-After`. |
 * | `eldorado` | **No rate limit is published anywhere on the wire.** Checked 2026-09-13 on live 200s of both `GET /methods` and `POST /public/v2/quote`: no `X-RateLimit-*`, no `Retry-After`, no `Cache-Control`. So the restraint here is entirely ours — and it is not about cadence but about **volume**: 4 payment methods x 4 brackets x 2 directions = 32 POSTs per cycle, each one creating a record on their side that is never traded (plan.md §7.1). The methods list is a deliberate 4 of 11 for that reason. `/methods` is not called per cycle at all: 289 KB of payment-form schemas we would discard. |
 * | `binance_p2p` | **No rate limit is stated in the response.** Checked 2026-09-13 on live 200s of the ad search: no `X-RateLimit-*`, no `Retry-After`. Listings change continuously, so there is no refresh cycle to be slower than. Two POSTs per cycle, one per direction — the cheapest of the six quote adapters. |
 * | `wise` | **`Cache-Control: no-cache, no-store, max-age=0, must-revalidate`**, observed 2026-09-13 on a live 200. No `X-RateLimit-*` or `Retry-After`. The endpoint is a periodic comparison harvest rather than a live quote — `dateCollected` on each entry says when Wise last polled that provider — so our fifteen minutes is coarser than anything it refreshes. Four GETs per cycle, one per bracket. |
 *
 * 15 minutes is comfortably conservative against every cadence in the first
 * table, and now against measured figures rather than description. Against
 * Yahoo's own 10-second freshness window we poll 90x slower; against er-api's
 * hour-long one, 4x slower; against a TRM that changes once a day, 96 polls
 * against one update. In every case our cadence is the coarser of the two,
 * which is the direction Art. V.3 requires.
 *
 * It cannot yet be called conservative against the second table, because there
 * is nothing there to compare it to.
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
  /** Defaults to GET. */
  method?: string;
  /**
   * A JSON body. Only Eldorado needs one: its quotes are POSTs rather than
   * reads, which is also why it is the provider §7.1 worries about.
   */
  json?: unknown;
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

  const method = options.method ?? 'GET';
  const body = options.json === undefined ? undefined : JSON.stringify(options.json);

  const headers: Record<string, string> = {
    'User-Agent': readIngestUserAgent(),
    Accept: 'application/json',
    ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    ...options.headers,
  };

  let lastStatus: number | undefined;
  let lastReason = '';

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let response: Response | undefined;

    try {
      response = await fetchImpl(url, {
        method,
        headers,
        ...(body === undefined ? {} : { body }),
        signal: AbortSignal.timeout(timeoutMs),
      });
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
