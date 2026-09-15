/**
 * Tests for the data client (T023).
 *
 * The done criterion is "a page prints the current quotes and the browser
 * bundle contains no Supabase credential". The second half is checked against
 * the real build in `check-bundle.ts`; this file covers the first half plus the
 * failure modes a page has to survive.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { __columns, fetchLatestQuotes, type LatestQuote } from './quotes.ts';

const realFetch = globalThis.fetch;
const realEnv = { ...process.env };

afterEach(() => {
  globalThis.fetch = realFetch;
  process.env['SUPABASE_URL'] = realEnv['SUPABASE_URL'];
  process.env['SUPABASE_SERVER_READ_KEY'] = realEnv['SUPABASE_SERVER_READ_KEY'];
});

function configure(): void {
  process.env['SUPABASE_URL'] = 'https://example.supabase.co';
  process.env['SUPABASE_SERVER_READ_KEY'] = 'sb_secret_test_key';
}

/** Captures the request instead of making one. */
function stub(body: unknown, status = 200): { calls: Request[] } {
  const calls: Request[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push(new Request(String(input), init));
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  return { calls };
}

/**
 * A complete row. TypeScript will not let this compile if the type gains a
 * field, which is what makes the column test below meaningful.
 */
const EXEMPLAR: LatestQuote = {
  provider_id: 'bitso',
  mode: 'local',
  asset: 'usdt',
  channel: 'exchange',
  direction: 'usd_to_cop',
  bracket_usd: 100,
  payment_method: null,
  fixed_side: 'in',
  amount_in: 100,
  currency_in: 'USD',
  amount_out: 306_550,
  currency_out: 'COP',
  status: 'ok',
  limit_reason: null,
  gross_rate: 3065.5,
  effective_rate: 3065.5,
  fee_pct: null,
  fee_fixed_usd: null,
  fee_amount_usd: null,
  amounts_source: 'computed',
  eta_minutes: null,
  captured_at: '2026-09-15T12:00:00Z',
  trm: 3109.3,
  trm_from: '2026-09-15',
  trm_to: '2026-09-15',
  mid_market: 3105.99,
  mid_market_src: 'yahoo',
  mid_market_at: '2026-09-15T11:45:00Z',
  markup_vs_trm: 0.014,
  markup_vs_mid: 0.013,
};

describe('what gets asked for', () => {
  it('never asks for raw — 87.6% of the payload, measured', () => {
    // 440 KB with it against 55 KB without, on a page whose main case is a
    // phone. It would also carry every captured response back out of the
    // database for nothing.
    assert.ok(!__columns.includes('raw' as never));
  });

  it('does not ask for internal bookkeeping either', () => {
    assert.ok(!__columns.includes('id' as never));
    assert.ok(!__columns.includes('run_id' as never));
  });

  it('asks for exactly the columns the type declares', () => {
    // The check that stops the select and the type drifting apart. Adding a
    // field to LatestQuote without adding the column gives a row that is
    // typed as present and arrives undefined — the worst shape, because
    // nothing fails until something renders blank.
    assert.deepEqual([...__columns].sort(), Object.keys(EXEMPLAR).sort());
  });

  it('sends the key as both apikey and bearer, which PostgREST needs', () => {
    configure();
    const { calls } = stub([EXEMPLAR]);

    return fetchLatestQuotes().then(() => {
      const request = calls[0];
      assert.ok(request !== undefined);
      assert.equal(request.headers.get('apikey'), 'sb_secret_test_key');
      assert.equal(request.headers.get('authorization'), 'Bearer sb_secret_test_key');
      assert.ok(request.url.includes('/rest/v1/latest_quotes'));
    });
  });
});

describe('the states a page has to survive', () => {
  it('returns the rows when there are rows', async () => {
    configure();
    stub([EXEMPLAR, { ...EXEMPLAR, provider_id: 'buda' }]);

    const result = await fetchLatestQuotes();
    assert.equal(result.kind, 'ok');
    assert.ok(result.kind === 'ok');
    assert.equal(result.quotes.length, 2);
  });

  it('tells an empty window apart from a failure', async () => {
    // Nothing captured in 24 h is a real state and not an error. A page must
    // be able to say which of the two happened.
    configure();
    stub([]);
    assert.equal((await fetchLatestQuotes()).kind, 'empty');
  });

  it('reports a missing configuration instead of guessing', async () => {
    process.env['SUPABASE_URL'] = '';
    process.env['SUPABASE_SERVER_READ_KEY'] = '';

    const result = await fetchLatestQuotes();
    assert.equal(result.kind, 'failed');
    assert.ok(result.kind === 'failed');
    assert.match(result.reason, /SUPABASE_URL/);
  });

  it('reports an HTTP error rather than returning an empty list', async () => {
    // Returning [] on a 500 would render as "no quotes", which reads to a
    // visitor as a market with no prices rather than as a broken page.
    configure();
    stub({ message: 'nope' }, 500);

    const result = await fetchLatestQuotes();
    assert.equal(result.kind, 'failed');
    assert.ok(result.kind === 'failed');
    assert.match(result.reason, /500/);
  });

  it('never throws — the page answers, the ingest is unaffected', async () => {
    configure();
    globalThis.fetch = (async () => {
      throw new Error('getaddrinfo ENOTFOUND');
    }) as typeof fetch;

    const result = await fetchLatestQuotes();
    assert.equal(result.kind, 'failed');
    assert.ok(result.kind === 'failed');
    assert.match(result.reason, /ENOTFOUND/);
  });
});

describe('the row cap, which is the lesson of 2026-09-15', () => {
  it('refuses a result that reached the cap instead of ranking a truncated one', async () => {
    // PostgREST silently caps a result set. That turned a healthy alarm into a
    // false red by dropping 924 of 1924 rows without a word. The view cannot
    // produce this many, so reaching it means something changed — and a
    // truncated ranking is a wrong ranking, not a shorter one.
    configure();
    stub(Array.from({ length: 500 }, () => EXEMPLAR));

    const result = await fetchLatestQuotes();
    assert.equal(result.kind, 'failed');
    assert.ok(result.kind === 'failed');
    assert.match(result.reason, /truncated/);
  });

  it('is happy with the 74 the view actually produces', async () => {
    configure();
    stub(Array.from({ length: 74 }, () => EXEMPLAR));

    const result = await fetchLatestQuotes();
    assert.equal(result.kind, 'ok');
  });
});
