/**
 * Tests for the mid-market adapter (T011).
 *
 * Against real saved responses, with no network (Art. VII.3). Both fixtures were
 * captured live on Sunday 2026-09-13, with the FX market closed — which is the
 * case that can break, and the reason a weekday capture would have proved less.
 *
 * The fallback gets the same scrutiny as the primary. It is the path that runs
 * on the day Yahoo changes, and a fallback that has never been exercised is a
 * guess about the future.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { TEST_USER_AGENT } from '../http.ts';
import {
  createMidMarketAdapter,
  ER_API_URL,
  type ErApiResponse,
  parseErApi,
  parseYahoo,
  YAHOO_URL,
  type YahooResponse,
} from './mid-market.ts';

const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures');

function fixture<T>(name: string): T {
  return JSON.parse(readFileSync(resolve(FIXTURES, name), 'utf8')) as T;
}

const YAHOO = fixture<YahooResponse>('mid-market-yahoo-weekend-2026-09-13.json');
const ER_API = fixture<ErApiResponse>('mid-market-er-api-2026-09-13.json');

/** Routes by URL, so the fallback can be driven by failing only the primary. */
function router(handlers: Record<string, () => Response | Promise<Response>>) {
  const calls: string[] = [];
  const impl = (async (url: string | URL | Request) => {
    const key = String(url);
    calls.push(key);
    const handler = handlers[key];
    if (handler === undefined) throw new Error(`unexpected URL: ${key}`);
    return handler();
  }) as unknown as typeof fetch;
  return { impl, calls };
}

function ok(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

const NO_WAITING = { maxAttempts: 1, sleep: async () => {} };

describe('Yahoo, the primary', () => {
  it('reads the rate and the moment the datum belongs to', () => {
    const reference = parseYahoo(YAHOO);

    assert.equal(reference.kind, 'mid_market');
    assert.equal(reference.value, 3079.23);
    assert.equal(reference.source, 'yahoo');
    assert.equal(reference.observed_at, '2026-09-13T20:00:00.000Z');
  });

  it('observed_at is the datum, not the capture', () => {
    const reference = parseYahoo(YAHOO);
    const observed = Date.parse(reference.observed_at ?? '');

    // The fixture was captured after the datum, and by a margin the test can
    // assert without depending on when it runs.
    assert.ok(observed < Date.now(), 'the datum is in the past relative to any capture');
    assert.notEqual(reference.observed_at, new Date().toISOString());
  });

  it('keeps the whole response in raw', () => {
    assert.deepEqual(parseYahoo(YAHOO).raw, YAHOO);
  });

  it('refuses a price with no timestamp', () => {
    const noTime: YahooResponse = {
      chart: { result: [{ meta: { regularMarketPrice: 3079.23 } }] },
    };
    assert.throws(() => parseYahoo(noTime), /no regularMarketTime/);
  });

  it('refuses an unusable price rather than coercing it', () => {
    for (const price of [0, -1, Number.NaN]) {
      const body: YahooResponse = {
        chart: { result: [{ meta: { regularMarketPrice: price, regularMarketTime: 1789329600 } }] },
      };
      assert.throws(() => parseYahoo(body), /not a usable rate/);
    }
  });

  it('refuses an empty result', () => {
    assert.throws(() => parseYahoo({ chart: { result: [] } }), /no result/);
    assert.throws(() => parseYahoo({}), /no result/);
  });
});

describe('the weekend case, which is what can break', () => {
  it('the datum is not frozen at the Friday session close', () => {
    // Measured, not assumed. On Sunday 2026-09-13 the latest point Yahoo served
    // was timestamped that same Sunday at 20:00Z, while the last session ended
    // 2026-09-11T22:59Z. An adapter built on "the weekend returns Friday" would
    // be wrong about which day it is looking at.
    const reference = parseYahoo(YAHOO);
    const observed = new Date(reference.observed_at ?? '');

    assert.equal(observed.getUTCDay(), 0, 'the timestamp lands on a Sunday');
    assert.ok(
      observed.getTime() > Date.parse('2026-09-11T22:59:00.000Z'),
      'and after the last session close, not at it',
    );
  });

  it('the rate is still a real number on a closed market — nothing is interpolated', () => {
    const reference = parseYahoo(YAHOO);
    assert.equal(typeof reference.value, 'number');
    assert.ok(reference.value > 0);
    // Art. I.4: a frozen rate is the correct answer on a closed market. The
    // adapter neither smooths it nor carries anything forward.
  });
});

describe('er-api, the fallback', () => {
  it('reads the COP rate and the update it belongs to', () => {
    const reference = parseErApi(ER_API);

    assert.equal(reference.kind, 'mid_market');
    assert.equal(reference.value, 3105.776374);
    assert.equal(reference.source, 'er_api');
    assert.equal(reference.observed_at, '2026-09-13T00:02:31.000Z');
  });

  it('refuses a response that does not report success', () => {
    assert.throws(() => parseErApi({ result: 'error', rates: { COP: 3105 } }), /did not report/);
  });

  it('refuses a response with no COP at all', () => {
    const noCop: ErApiResponse = {
      result: 'success',
      time_last_update_unix: 1789257751,
      rates: { EUR: 0.9 },
    };
    assert.throws(() => parseErApi(noCop), /not a usable rate/);
  });

  it('refuses a rate with no timestamp', () => {
    const noTime: ErApiResponse = { result: 'success', rates: { COP: 3105.77 } };
    assert.throws(() => parseErApi(noTime), /no time_last_update_unix/);
  });
});

describe('mid_market_src always says which one answered', () => {
  it('reports yahoo when the primary works, and never calls the fallback', async () => {
    const { impl, calls } = router({ [YAHOO_URL]: () => ok(YAHOO) });
    const adapter = createMidMarketAdapter({
      fetchImpl: impl,
      userAgent: TEST_USER_AGENT,
      ...NO_WAITING,
    });

    const reference = await adapter.fetchReference();

    assert.equal(reference.source, 'yahoo');
    assert.deepEqual(calls, [YAHOO_URL], 'er-api is left alone while Yahoo answers');
  });

  it('reports er_api when the primary fails, and the value comes from the fallback', async () => {
    const { impl, calls } = router({
      [YAHOO_URL]: () => new Response('gateway is unhappy', { status: 503 }),
      [ER_API_URL]: () => ok(ER_API),
    });

    const fellBack: string[] = [];
    const adapter = createMidMarketAdapter({
      fetchImpl: impl,
      userAgent: TEST_USER_AGENT,
      onFallback: (error) => fellBack.push(error.message),
      ...NO_WAITING,
    });

    const reference = await adapter.fetchReference();

    assert.equal(reference.source, 'er_api', 'the column records the source, not the intent');
    assert.equal(reference.value, 3105.776374, 'and the number is the fallback’s, not a stale one');
    assert.deepEqual(calls, [YAHOO_URL, ER_API_URL], 'primary first, then fallback');
    assert.equal(fellBack.length, 1);
  });

  it('falls back on a malformed primary response, not just on a dead one', async () => {
    // Yahoo answering 200 with a shape we cannot read is the likelier failure:
    // an API change does not arrive as a 503.
    const { impl } = router({
      [YAHOO_URL]: () => ok({ chart: { result: [{ meta: {} }] } }),
      [ER_API_URL]: () => ok(ER_API),
    });
    const adapter = createMidMarketAdapter({
      fetchImpl: impl,
      userAgent: TEST_USER_AGENT,
      ...NO_WAITING,
    });

    assert.equal((await adapter.fetchReference()).source, 'er_api');
  });

  it('names both sources when both fail', async () => {
    const { impl } = router({
      [YAHOO_URL]: () => new Response('nope', { status: 500 }),
      [ER_API_URL]: () => new Response('also nope', { status: 500 }),
    });
    const adapter = createMidMarketAdapter({
      fetchImpl: impl,
      userAgent: TEST_USER_AGENT,
      ...NO_WAITING,
    });

    await assert.rejects(() => adapter.fetchReference(), /both sources failed/);
    await assert.rejects(() => adapter.fetchReference(), /yahoo:.*er_api:/s);
  });
});
