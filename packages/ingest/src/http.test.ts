/**
 * Tests for the shared HTTP client (T006c).
 *
 * The backoff tests are written to a specific standard, because the obvious
 * version of them is worthless: asserting "it did not retry immediately" does
 * not distinguish a client that backed off from a client that simply gave up on
 * the first error. Both leave one call and no second attempt.
 *
 * So every backoff test asserts three things together:
 *   1. the request WAS retried — the call count went up,
 *   2. it slept BEFORE each retry — with the delay captured, not inferred,
 *   3. the delays follow the exponential schedule — the actual numbers.
 *
 * Jitter is pinned by injecting `random: () => 0.5`, the midpoint, which
 * multiplies by exactly 1. The schedule is therefore exact, not a range.
 */

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  backoffDelay,
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_TIMEOUT_MS,
  HttpError,
  httpJson,
  httpRequest,
  isRetryableStatus,
  parseRetryAfter,
  TEST_USER_AGENT,
} from './http.ts';

const URL_UNDER_TEST = 'https://example.test/quotes';

beforeEach(() => {
  // A reachable-looking contact. The .env.example placeholder is rejected on
  // purpose, so it cannot be used here either.
  process.env['INGEST_USER_AGENT'] = 'dolarito/0.1 (+https://dolarito.test; hola@dolarito.test)';
});

/** A fetch double: replays a queued script and records every call. */
function stubFetch(script: Array<Response | Error>) {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];

  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const next = script[calls.length - 1];
    if (next === undefined) throw new Error('stub ran out of scripted responses');
    if (next instanceof Error) throw next;
    return next;
  }) as unknown as typeof fetch;

  return { impl, calls };
}

function json(status: number, body: unknown = {}, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

/** Captures the delays instead of waiting them out. */
function recordingSleep() {
  const delays: number[] = [];
  const sleep = async (ms: number): Promise<void> => {
    delays.push(ms);
  };
  return { delays, sleep };
}

describe('backoff — it retried, it slept first, and the schedule is exponential', () => {
  it('429 then 429 then 200: two retries, delays 1000 and 2000', async () => {
    const { impl, calls } = stubFetch([json(429), json(429), json(200, { ok: true })]);
    const { delays, sleep } = recordingSleep();

    const response = await httpRequest(URL_UNDER_TEST, {
      fetchImpl: impl,
      sleep,
      random: () => 0.5,
    });

    assert.equal(response.status, 200);
    assert.equal(calls.length, 3, 'it must actually retry, not just fail slowly');
    assert.deepEqual(delays, [1000, 2000], 'exponential, and one sleep per retry');
  });

  it('504 is retried: the Supabase cold start must not count as an outage', async () => {
    const { impl, calls } = stubFetch([json(504), json(200, { ok: true })]);
    const { delays, sleep } = recordingSleep();

    await httpRequest(URL_UNDER_TEST, { fetchImpl: impl, sleep, random: () => 0.5 });

    assert.equal(calls.length, 2);
    assert.deepEqual(delays, [1000]);
  });

  it('exhausting the attempts sleeps three times and then throws', async () => {
    const { impl, calls } = stubFetch([json(503), json(503), json(503), json(503)]);
    const { delays, sleep } = recordingSleep();

    await assert.rejects(
      () => httpRequest(URL_UNDER_TEST, { fetchImpl: impl, sleep, random: () => 0.5 }),
      (error: unknown) => {
        assert.ok(error instanceof HttpError);
        assert.equal(error.status, 503);
        assert.equal(error.attempts, DEFAULT_MAX_ATTEMPTS);
        return true;
      },
    );

    assert.equal(calls.length, 4, 'four attempts: one try plus three retries');
    assert.deepEqual(delays, [1000, 2000, 4000], 'doubling, never flat');
  });

  it('a transport failure backs off the same way a 5xx does', async () => {
    const { impl, calls } = stubFetch([new Error('socket hang up'), json(200, { ok: true })]);
    const { delays, sleep } = recordingSleep();

    await httpRequest(URL_UNDER_TEST, { fetchImpl: impl, sleep, random: () => 0.5 });

    assert.equal(calls.length, 2);
    assert.deepEqual(delays, [1000]);
  });
});

describe('backoff — what must NOT be retried', () => {
  it('a 404 throws on the first attempt, with no sleep at all', async () => {
    const { impl, calls } = stubFetch([json(404)]);
    const { delays, sleep } = recordingSleep();

    await assert.rejects(
      () => httpRequest(URL_UNDER_TEST, { fetchImpl: impl, sleep }),
      (error: unknown) => {
        assert.ok(error instanceof HttpError);
        assert.equal(error.status, 404);
        assert.equal(error.attempts, 1);
        return true;
      },
    );

    assert.equal(calls.length, 1, 'a 404 will not become a 200 by asking again');
    assert.deepEqual(delays, [], 'and it must not rest a source that answered fine');
  });

  it('classifies statuses the way Art. V.5 does', () => {
    assert.equal(isRetryableStatus(429), true);
    assert.equal(isRetryableStatus(500), true);
    assert.equal(isRetryableStatus(502), true);
    assert.equal(isRetryableStatus(503), true);
    assert.equal(isRetryableStatus(504), true);
    assert.equal(isRetryableStatus(400), false);
    assert.equal(isRetryableStatus(401), false);
    assert.equal(isRetryableStatus(404), false);
  });
});

describe('backoff — the source outranks our schedule', () => {
  it('honours Retry-After in seconds instead of the exponential delay', async () => {
    const { impl } = stubFetch([json(429, {}, { 'retry-after': '7' }), json(200, { ok: true })]);
    const { delays, sleep } = recordingSleep();

    await httpRequest(URL_UNDER_TEST, { fetchImpl: impl, sleep, random: () => 0.5 });

    assert.deepEqual(delays, [7000], 'not the 1000 our own schedule would have picked');
  });

  it('parses both forms and clamps the wait', () => {
    const now = Date.parse('2026-09-13T17:00:00Z');
    assert.equal(parseRetryAfter('3', now), 3000);
    assert.equal(parseRetryAfter('Sun, 13 Sep 2026 17:00:30 GMT', now), 30_000);
    assert.equal(parseRetryAfter('99999', now), 60_000, 'clamped');
    assert.equal(parseRetryAfter(null, now), undefined);
    assert.equal(parseRetryAfter('nonsense', now), undefined);
  });

  it('grows exponentially and stays inside the jitter band', () => {
    assert.equal(
      backoffDelay(1, 1000, () => 0.5),
      1000,
    );
    assert.equal(
      backoffDelay(2, 1000, () => 0.5),
      2000,
    );
    assert.equal(
      backoffDelay(3, 1000, () => 0.5),
      4000,
    );
    assert.equal(
      backoffDelay(1, 1000, () => 0),
      800,
    );
    assert.equal(
      backoffDelay(1, 1000, () => 0.999),
      1200,
    );
  });
});

describe('identity and timeout', () => {
  it('sends an identifiable User-Agent with a contact in it', async () => {
    const { impl, calls } = stubFetch([json(200, { ok: true })]);

    await httpRequest(URL_UNDER_TEST, { fetchImpl: impl });

    const headers = calls[0]?.init?.headers as Record<string, string>;
    const agent = headers['User-Agent'] ?? '';
    assert.ok(agent.includes('dolarito'), 'says who we are');
    assert.match(agent, /https?:\/\/\S+|[^\s@]+@[^\s@]+\.[^\s@]+/, 'says how to reach us');
  });

  it('refuses to send the .env.example placeholder', async () => {
    process.env['INGEST_USER_AGENT'] =
      'dolarito/0.1 (+https://example.invalid; contact@example.invalid)';
    const { impl, calls } = stubFetch([json(200, { ok: true })]);

    await assert.rejects(() => httpRequest(URL_UNDER_TEST, { fetchImpl: impl }), /placeholder/);
    assert.equal(calls.length, 0, 'nothing may leave the process without a real contact');
  });

  it('refuses a User-Agent with no way to reach us', async () => {
    process.env['INGEST_USER_AGENT'] = 'dolarito/0.1';
    const { impl, calls } = stubFetch([json(200, { ok: true })]);

    await assert.rejects(() => httpRequest(URL_UNDER_TEST, { fetchImpl: impl }), /Art\. V\.4/);
    assert.equal(calls.length, 0);
  });

  it('sends an explicitly supplied identity instead of the environment', async () => {
    delete process.env['INGEST_USER_AGENT'];
    const { impl, calls } = stubFetch([json(200, { ok: true })]);

    await httpRequest(URL_UNDER_TEST, { fetchImpl: impl, userAgent: TEST_USER_AGENT });

    const headers = calls[0]?.init?.headers as Record<string, string>;
    assert.equal(headers['User-Agent'], TEST_USER_AGENT);
  });

  // The seam buys a test its own identity. It must not buy it an exemption:
  // if the explicit path skipped the Art. V.4 gate, every adapter test would be
  // exercising a client that no longer enforces it.
  it('holds an explicitly supplied identity to the same Art. V.4 gate', async () => {
    const { impl, calls } = stubFetch([json(200, { ok: true })]);

    await assert.rejects(
      () => httpRequest(URL_UNDER_TEST, { fetchImpl: impl, userAgent: 'dolarito/0.1' }),
      /Art\. V\.4/,
    );
    assert.equal(calls.length, 0, 'the seam is not a way around the identity rule');
  });

  it('defaults to a 10 second timeout', () => {
    assert.equal(DEFAULT_TIMEOUT_MS, 10_000);
  });

  // The stub below hangs forever unless the signal aborts it, which is exactly
  // the point — but without a bounded timeout the failure mode is a hung suite
  // rather than a red test. A mutation probe that unwires the signal proved it:
  // the run stopped dead instead of reporting. 1s is far above the 20ms this
  // needs and far below anything that would wedge CI.
  //
  // ## Why it races an explicit deadline (2026-09-15)
  //
  // This test died in CI as `cancelled`, its promise left unsettled, and had
  // never failed here. What is measured: **`AbortSignal.timeout()` uses an
  // unref'd timer**, so it does not hold the event loop open. A probe whose
  // only pending work is such a signal exits *before* the abort fires, with
  // "unsettled top-level await" and code 13.
  //
  // What is NOT measured, and is not claimed: that this is what CI hit. It
  // cannot be reproduced here, because under `node --test` the runner itself
  // holds the loop open — removing the scaffolding below still passes locally.
  // Local node is 24 and CI pins 22, so a local green is evidence about node 24
  // and about nothing else, which is the same lesson the @v5 bump taught.
  //
  // So rather than bet on the diagnosis, the test is made unable to hang at
  // all. The deadline is a *ref'd* timer, which holds the loop open whoever
  // else does not — and it rejects with a sentence instead of leaving the
  // promise pending, so "the signal never fired" arrives as a red test naming
  // the cause rather than as a cancellation that reads like CI noise.
  it('passes an abort signal that actually fires', { timeout: 1_000 }, async () => {
    const impl = (async (_url: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (signal === undefined || signal === null) {
          // Without this the unwired-signal mutation hangs instead of failing.
          reject(new Error('no signal was passed'));
          return;
        }
        signal.addEventListener('abort', () => {
          reject(new Error('aborted by signal'));
        });
      })) as unknown as typeof fetch;

    let deadline: NodeJS.Timeout | undefined;
    const neverFired = new Promise<never>((_resolve, reject) => {
      deadline = setTimeout(() => {
        reject(new Error('the abort signal never fired'));
      }, 500);
    });

    try {
      await assert.rejects(
        () =>
          Promise.race([
            httpRequest(URL_UNDER_TEST, { fetchImpl: impl, timeoutMs: 20, maxAttempts: 1 }),
            neverFired,
          ]),
        /aborted by signal/,
      );
    } finally {
      clearTimeout(deadline);
    }
  });
});

describe('httpJson', () => {
  it('parses the body of a successful response', async () => {
    const { impl } = stubFetch([json(200, { valor: '4012.34' })]);
    const body = await httpJson<{ valor: string }>(URL_UNDER_TEST, { fetchImpl: impl });
    assert.deepEqual(body, { valor: '4012.34' });
  });
});

/**
 * The seam is for tests, and saying so in a comment does not make it true.
 *
 * If production code ever passed `userAgent`, a source would receive an
 * identity that never came from `INGEST_USER_AGENT` — which is how the one
 * place that must hold the real contact stops being the one place. Same shape
 * as the T009 check that reads `orchestrator.ts` rather than asserting a
 * property that would quietly stop being true.
 */
describe('the identity seam stays out of production', () => {
  const SRC = dirname(fileURLToPath(import.meta.url));

  function sourcesUnder(dir: string): string[] {
    const found: string[] = [];
    for (const entry of readdirSync(resolve(SRC, dir), { withFileTypes: true })) {
      if (entry.isDirectory()) {
        found.push(...sourcesUnder(`${dir}/${entry.name}`));
        continue;
      }
      if (!entry.name.endsWith('.ts')) continue;
      if (entry.name.endsWith('.test.ts')) continue;
      found.push(`${dir}/${entry.name}`);
    }
    return found;
  }

  it('no adapter, reference or script supplies its own identity', () => {
    const files = [
      ...sourcesUnder('adapters'),
      ...sourcesUnder('references'),
      ...sourcesUnder('scripts'),
      'orchestrator.ts',
      'db.ts',
      'registry.ts',
    ];
    assert.ok(files.length > 15, `expected the whole surface, got ${files.length} files`);

    const offenders = files.filter((file) => {
      const source = readFileSync(resolve(SRC, file), 'utf8');
      return source.includes('userAgent') || source.includes('TEST_USER_AGENT');
    });

    assert.deepEqual(
      offenders,
      [],
      'production reads INGEST_USER_AGENT; only tests may hand in an identity',
    );
  });
});
