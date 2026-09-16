/**
 * Tests for the Buda adapter (T014).
 *
 * Against a real ticker saved on 2026-09-13, with no network (Art. VII.3).
 *
 * Carries the spread assertion required by plan.md §3 rule 6, by value — and
 * here it also documents the thin book: 2.03% against Bitso's 0.46% on the same
 * pair the same minute.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { TEST_USER_AGENT } from '../http.ts';
import {
  BUDA_URL,
  type BudaResponse,
  buildQuotes,
  createBudaAdapter,
  parseTicker,
  rateFor,
} from './buda.ts';

const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures');
const TICKER = JSON.parse(
  readFileSync(resolve(FIXTURES, 'buda-usdt-cop-2026-09-13.json'), 'utf8'),
) as BudaResponse;

const MIN_ASK = 3102.89;
const MAX_BID = 3041.0;
const BRACKETS = [1, 100, 500, 1000];
const CAPTURED = '2026-09-13T21:00:00.000Z';

function stubFetch(body: unknown) {
  const calls: string[] = [];
  const impl = (async (url: string | URL | Request) => {
    calls.push(String(url));
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

function quotes() {
  return buildQuotes(parseTicker(TICKER), TICKER, CAPTURED);
}

describe('the ticker, with its [amount, currency] pairs', () => {
  it('reads both sides out of the tuples', () => {
    assert.deepEqual(parseTicker(TICKER), { minAsk: MIN_ASK, maxBid: MAX_BID });
  });

  it('refuses a pair quoted in another currency', () => {
    // Read as pesos, a USD-denominated tuple would be wrong by an exchange
    // rate and nothing downstream would notice.
    const foreign: BudaResponse = {
      ticker: { ...TICKER.ticker, min_ask: ['3102.89', 'USD'] },
    };
    assert.throws(() => parseTicker(foreign), /quoted in USD, not COP/);
  });

  it('refuses something that is not a pair at all', () => {
    const broken = { ticker: { ...TICKER.ticker, max_bid: '3041.0' } } as unknown as BudaResponse;
    assert.throws(() => parseTicker(broken), /not an \[amount, currency\] pair/);
  });

  it('refuses a different market', () => {
    const other: BudaResponse = { ticker: { ...TICKER.ticker, market_id: 'BTC-CLP' } };
    assert.throws(() => parseTicker(other), /expected the USDT-COP market/);
  });

  it('refuses an unreadable rate and a crossed book', () => {
    const bad: BudaResponse = { ticker: { ...TICKER.ticker, min_ask: ['0', 'COP'] } };
    assert.throws(() => parseTicker(bad), /not a usable rate/);

    const crossed: BudaResponse = {
      ticker: { ...TICKER.ticker, min_ask: ['3000', 'COP'], max_bid: ['3100', 'COP'] },
    };
    assert.throws(() => parseTicker(crossed), /crossed book/);
  });

  it('refuses a response with no ticker', () => {
    assert.throws(() => parseTicker({}), /no ticker/);
  });
});

describe('eight rows with the catalogue identity', () => {
  it('produces eight, across both directions and every bracket', () => {
    assert.equal(quotes().length, 8);
    for (const direction of ['usd_to_cop', 'cop_to_usd'] as const) {
      const seen = quotes()
        .filter((q) => q.direction === direction)
        .map((q) => q.bracket_usd)
        .sort((a, b) => a - b);
      assert.deepEqual(seen, BRACKETS);
    }
  });

  it('is usdt over exchange, computed, with no invented fees', () => {
    for (const quote of quotes()) {
      assert.equal(quote.provider_id, 'buda');
      assert.equal(quote.asset, 'usdt');
      assert.equal(quote.channel, 'exchange');
      assert.equal(quote.amounts_source, 'computed');
      assert.equal(quote.fee_pct, undefined);
      assert.equal(quote.fee_fixed_usd, undefined);
    }
  });
});

describe('fixed_side and the side of the book', () => {
  it('the fixed leg is USD and equals the bracket', () => {
    for (const quote of quotes()) {
      assert.ok(quote.status === 'ok');
      const fixed = quote.fixed_side === 'in' ? quote.in : quote.out;
      assert.equal(quote.fixed_side, quote.direction === 'usd_to_cop' ? 'in' : 'out');
      assert.equal(fixed.currency, 'USD');
      assert.equal(fixed.amount, quote.bracket_usd);
    }
  });

  it('buying hits min_ask, selling hits max_bid', () => {
    const ticker = parseTicker(TICKER);
    assert.equal(rateFor(ticker, 'cop_to_usd'), MIN_ASK);
    assert.equal(rateFor(ticker, 'usd_to_cop'), MAX_BID);
  });
});

describe('the spread assertion (plan.md §3, rule 6)', () => {
  it('buying costs more than selling yields, at every bracket', () => {
    for (const bracket of BRACKETS) {
      const selling = quotes().find(
        (q) => q.direction === 'usd_to_cop' && q.bracket_usd === bracket,
      );
      const buying = quotes().find(
        (q) => q.direction === 'cop_to_usd' && q.bracket_usd === bracket,
      );

      assert.ok(selling?.status === 'ok' && buying?.status === 'ok');
      assert.ok(
        buying.in.amount > selling.out.amount,
        `@${bracket}: paying ${buying.in.amount} must exceed receiving ${selling.out.amount}`,
      );
    }
  });

  it('by the amounts the fixture actually implies', () => {
    const selling = quotes().find((q) => q.direction === 'usd_to_cop' && q.bracket_usd === 100);
    const buying = quotes().find((q) => q.direction === 'cop_to_usd' && q.bracket_usd === 100);

    assert.ok(selling?.status === 'ok' && buying?.status === 'ok');
    assert.deepEqual(selling.out, { amount: 304_100, currency: 'COP' });
    assert.deepEqual(buying.in, { amount: 310_289, currency: 'COP' });
  });
});

describe('the thin book, measured rather than described', () => {
  it('the spread is wide enough to matter', () => {
    // 2.03% here against 0.46% at Bitso on the same pair the same minute. The
    // provider row carries the warning; this pins the fact it rests on.
    const spread = MIN_ASK / MAX_BID - 1;
    assert.ok(spread > 0.015, `${(spread * 100).toFixed(2)}% is not wide`);

    // 6,189 COP on a 100 USD trade — that is the cost of this venue, and it is
    // a real price rather than a broken one. It gets shown, not hidden.
    const selling = quotes().find((q) => q.direction === 'usd_to_cop' && q.bracket_usd === 100);
    const buying = quotes().find((q) => q.direction === 'cop_to_usd' && q.bracket_usd === 100);
    assert.ok(selling?.status === 'ok' && buying?.status === 'ok');
    assert.equal(buying.in.amount - selling.out.amount, 6_189);
  });
});

describe('the adapter', () => {
  it('declares itself and covers one provider', () => {
    const adapter = createBudaAdapter();
    assert.equal(adapter.id, 'buda');
    assert.deepEqual(adapter.providerIds, ['buda']);
  });

  it('fetches once for all eight rows', async () => {
    const { impl, calls } = stubFetch(TICKER);
    const rows = await createBudaAdapter({
      fetchImpl: impl,
      userAgent: TEST_USER_AGENT,
      now: () => CAPTURED,
    }).fetchQuotes(BRACKETS);
    assert.equal(rows.length, 8);
    assert.deepEqual(calls, [BUDA_URL]);
  });

  it('throws instead of returning rows when it cannot read the source', async () => {
    const { impl } = stubFetch({});
    const adapter = createBudaAdapter({
      fetchImpl: impl,
      userAgent: TEST_USER_AGENT,
      maxAttempts: 1,
    });
    await assert.rejects(() => adapter.fetchQuotes(BRACKETS), /no ticker/);
  });
});
