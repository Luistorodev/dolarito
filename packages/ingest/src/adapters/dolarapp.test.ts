/**
 * Tests for the DolarApp adapter (T013).
 *
 * Against a real ticker saved on 2026-09-13, with no network (Art. VII.3).
 *
 * Carries the spread assertion required by plan.md §3 rule 6, by value.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { TEST_USER_AGENT } from '../http.ts';
import {
  buildQuotes,
  createDolarAppAdapter,
  DOLARAPP_URL,
  type DolarAppResponse,
  parseTicker,
  rateFor,
} from './dolarapp.ts';

const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures');
const TICKER = JSON.parse(
  readFileSync(resolve(FIXTURES, 'dolarapp-usdc-cop-2026-09-13.json'), 'utf8'),
) as DolarAppResponse;

const ASK = 3088.520448;
const BID = 3061.851273;
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

describe('the ticker', () => {
  it('reads both sides', () => {
    assert.deepEqual(parseTicker(TICKER), { ask: ASK, bid: BID });
  });

  it('refuses an empty or missing array', () => {
    assert.throws(() => parseTicker([]), /no ticker/);
  });

  it('refuses a different book', () => {
    assert.throws(
      () => parseTicker([{ ...TICKER[0], book: 'usdt_mxn' }]),
      /expected the usdc_cop book/,
    );
  });

  it('refuses an unreadable rate rather than coercing it', () => {
    for (const bad of [undefined, 'n/d', '0', '-5']) {
      assert.throws(() => parseTicker([{ ...TICKER[0], ask: bad }]), /ask/);
    }
  });

  it('refuses a crossed book', () => {
    assert.throws(() => parseTicker([{ ...TICKER[0], ask: '3000', bid: '3100' }]), /crossed book/);
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

  it('is usdc over fintech, computed', () => {
    for (const quote of quotes()) {
      assert.equal(quote.provider_id, 'dolarapp');
      assert.equal(quote.mode, 'local');
      assert.equal(quote.asset, 'usdc');
      assert.equal(quote.channel, 'fintech');
      assert.equal(quote.amounts_source, 'computed');
      assert.equal(quote.status, 'ok');
    }
  });

  it('leaves every fee undefined, because the source states none', () => {
    // The cost is inside the price. "Not stated" is not "free" (Art. I.1).
    for (const quote of quotes()) {
      assert.equal(quote.fee_pct, undefined);
      assert.equal(quote.fee_fixed_usd, undefined);
      assert.equal(quote.fee_amount_usd, undefined);
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

  it('buying hits the ask, selling hits the bid', () => {
    const ticker = parseTicker(TICKER);
    assert.equal(rateFor(ticker, 'cop_to_usd'), ASK);
    assert.equal(rateFor(ticker, 'usd_to_cop'), BID);
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
    // Pinned to real numbers, not to the code's own arithmetic. 0.87% apart.
    const selling = quotes().find((q) => q.direction === 'usd_to_cop' && q.bracket_usd === 100);
    const buying = quotes().find((q) => q.direction === 'cop_to_usd' && q.bracket_usd === 100);

    assert.ok(selling?.status === 'ok' && buying?.status === 'ok');
    assert.deepEqual(selling.out, { amount: 306_185, currency: 'COP' });
    assert.deepEqual(buying.in, { amount: 308_852, currency: 'COP' });
  });
});

describe('the adapter', () => {
  it('declares itself and covers one provider', () => {
    const adapter = createDolarAppAdapter();
    assert.equal(adapter.id, 'dolarapp');
    assert.equal(adapter.mode, 'local');
    assert.deepEqual(adapter.providerIds, ['dolarapp']);
  });

  it('fetches once for all eight rows', async () => {
    const { impl, calls } = stubFetch(TICKER);
    const rows = await createDolarAppAdapter({
      fetchImpl: impl,
      userAgent: TEST_USER_AGENT,
      now: () => CAPTURED,
    }).fetchQuotes(BRACKETS);
    assert.equal(rows.length, 8);
    assert.deepEqual(calls, [DOLARAPP_URL]);
  });

  it('throws instead of returning rows when it cannot read the source', async () => {
    const { impl } = stubFetch([]);
    const adapter = createDolarAppAdapter({
      fetchImpl: impl,
      userAgent: TEST_USER_AGENT,
      maxAttempts: 1,
    });
    await assert.rejects(() => adapter.fetchQuotes(BRACKETS), /no ticker/);
  });
});
