/**
 * Tests for the Bitso adapter (T012).
 *
 * Against a real ticker saved on 2026-09-13, with no network (Art. VII.3).
 *
 * Two things here are deliberately over-tested, because both fail silently and
 * plausibly:
 *
 *   1. **`fixed_side` per direction.** `usd_to_cop` fixes the input,
 *      `cop_to_usd` fixes the output. Inverting them produces eight rows that
 *      look fine and rank wrong.
 *   2. **Which side of the book each direction uses.** `ask` is 14.20 COP above
 *      `bid` in this fixture — 0.46%. Swapping them flatters the provider on
 *      every single row.
 *
 * Both are pinned by value, not by shape, so an inversion cannot pass.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { TEST_USER_AGENT } from '../http.ts';
import {
  BITSO_URL,
  type BitsoResponse,
  buildQuotes,
  createBitsoAdapter,
  parseTicker,
  rateFor,
} from './bitso.ts';

const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures');
const TICKER = JSON.parse(
  readFileSync(resolve(FIXTURES, 'bitso-usdt-cop-2026-09-13.json'), 'utf8'),
) as BitsoResponse;

const ASK = 3079.7;
const BID = 3065.5;
const BRACKETS = [1, 100, 500, 1000];
const CAPTURED = '2026-09-13T20:40:00.000Z';

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
  it('reads both sides of the book and the venue timestamp', () => {
    const ticker = parseTicker(TICKER);
    assert.equal(ticker.ask, ASK);
    assert.equal(ticker.bid, BID);
    assert.equal(ticker.createdAt, '2026-09-13T20:37:37+00:00');
  });

  it('refuses a response that does not report success', () => {
    assert.throws(() => parseTicker({ success: false, payload: TICKER.payload }), /did not report/);
  });

  it('refuses a different book — that is a different product, not a rounding error', () => {
    const other: BitsoResponse = {
      success: true,
      payload: { ...TICKER.payload, book: 'btc_mxn' },
    };
    assert.throws(() => parseTicker(other), /expected the usdt_cop book/);
  });

  it('refuses an unreadable rate rather than coercing it', () => {
    for (const bad of [undefined, 'n/d', '0', '-1']) {
      const body: BitsoResponse = {
        success: true,
        payload: { ...TICKER.payload, ask: bad },
      };
      assert.throws(() => parseTicker(body), /ask/);
    }
  });

  it('refuses a crossed book', () => {
    const crossed: BitsoResponse = {
      success: true,
      payload: { ...TICKER.payload, ask: '3000', bid: '3100' },
    };
    assert.throws(() => parseTicker(crossed), /crossed book/);
  });

  it('refuses a ticker with no created_at', () => {
    const body: BitsoResponse = {
      success: true,
      payload: { book: 'usdt_cop', ask: '3079.7', bid: '3065.5' },
    };
    assert.throws(() => parseTicker(body), /no created_at/);
  });
});

describe('eight rows, two directions across four brackets', () => {
  it('produces exactly eight', () => {
    assert.equal(quotes().length, 8);
  });

  it('covers every bracket in both directions', () => {
    for (const direction of ['usd_to_cop', 'cop_to_usd'] as const) {
      const seen = quotes()
        .filter((q) => q.direction === direction)
        .map((q) => q.bracket_usd)
        .sort((a, b) => a - b);
      assert.deepEqual(seen, BRACKETS, direction);
    }
  });

  it('carries the catalogue identity on every row', () => {
    for (const quote of quotes()) {
      assert.equal(quote.provider_id, 'bitso');
      assert.equal(quote.mode, 'local');
      assert.equal(quote.asset, 'usdt');
      assert.equal(quote.channel, 'exchange');
      assert.equal(quote.amounts_source, 'computed');
      assert.equal(quote.status, 'ok');
      assert.equal(quote.captured_at, CAPTURED);
    }
  });

  it('leaves every fee undefined — the ticker states none (Art. I.1)', () => {
    for (const quote of quotes()) {
      assert.equal(quote.fee_pct, undefined);
      assert.equal(quote.fee_fixed_usd, undefined);
      assert.equal(quote.fee_amount_usd, undefined);
      assert.notEqual(quote.fee_pct, 0, 'unknown is not free');
    }
  });
});

describe('fixed_side is correct per direction', () => {
  it('usd_to_cop fixes the input, cop_to_usd fixes the output', () => {
    for (const quote of quotes()) {
      const expected = quote.direction === 'usd_to_cop' ? 'in' : 'out';
      assert.equal(quote.fixed_side, expected, `${quote.direction} @ ${quote.bracket_usd}`);
    }
  });

  it('the fixed side is the USD leg, and it equals the bracket exactly', () => {
    // This is the assertion an inversion cannot survive. If fixed_side were
    // flipped, the "fixed" leg would be the COP one — a number in the hundreds
    // of thousands, in the wrong currency.
    for (const quote of quotes()) {
      assert.ok(quote.status === 'ok');
      const fixed = quote.fixed_side === 'in' ? quote.in : quote.out;
      const variable = quote.fixed_side === 'in' ? quote.out : quote.in;

      assert.equal(fixed.currency, 'USD', `${quote.direction} fixed leg`);
      assert.equal(fixed.amount, quote.bracket_usd, `${quote.direction} fixed leg amount`);
      assert.equal(variable.currency, 'COP', `${quote.direction} variable leg`);
    }
  });

  it('the person hands over USD selling, and pesos buying', () => {
    for (const quote of quotes()) {
      assert.ok(quote.status === 'ok');
      if (quote.direction === 'usd_to_cop') {
        assert.equal(quote.in.currency, 'USD', 'hands over dollars');
        assert.equal(quote.out.currency, 'COP', 'receives pesos');
      } else {
        assert.equal(quote.in.currency, 'COP', 'hands over pesos');
        assert.equal(quote.out.currency, 'USD', 'receives dollars');
      }
    }
  });
});

describe('each direction hits its own side of the book', () => {
  it('maps the sides explicitly', () => {
    const ticker = parseTicker(TICKER);
    assert.equal(rateFor(ticker, 'cop_to_usd'), ASK, 'buying USDT hits the ask');
    assert.equal(rateFor(ticker, 'usd_to_cop'), BID, 'selling USDT hits the bid');
  });

  it('every row records the side it actually used', () => {
    for (const quote of quotes()) {
      const expected = quote.direction === 'cop_to_usd' ? ASK : BID;
      assert.equal(quote.gross_rate, expected, `${quote.direction} gross_rate`);
    }
  });

  it('the amounts themselves land on the right side, by value', () => {
    // Pinned against the real spread rather than against the code's own
    // arithmetic. Selling 100 USDT at the bid yields 306,550 COP; buying 100 at
    // the ask costs 307,970. Swapping them would report 1,420 COP in the
    // provider's favour on this bracket alone.
    const selling = quotes().find((q) => q.direction === 'usd_to_cop' && q.bracket_usd === 100);
    const buying = quotes().find((q) => q.direction === 'cop_to_usd' && q.bracket_usd === 100);

    assert.ok(selling?.status === 'ok' && buying?.status === 'ok');
    assert.deepEqual(selling.out, { amount: 306_550, currency: 'COP' });
    assert.deepEqual(buying.in, { amount: 307_970, currency: 'COP' });

    assert.ok(
      buying.in.amount > selling.out.amount,
      'buying must cost more than selling yields — otherwise the book is inverted',
    );
  });
});

describe('the rate does not vary with the amount', () => {
  it('every bracket in a direction shares one gross_rate', () => {
    for (const direction of ['usd_to_cop', 'cop_to_usd'] as const) {
      const rates = new Set(
        quotes()
          .filter((q) => q.direction === direction)
          .map((q) => q.gross_rate),
      );
      assert.equal(rates.size, 1, `${direction} should quote one rate for every bracket`);
    }
  });

  it('the variable side scales with the bracket', () => {
    const selling = quotes()
      .filter((q) => q.direction === 'usd_to_cop')
      .sort((a, b) => a.bracket_usd - b.bracket_usd);

    assert.ok(selling.every((q) => q.status === 'ok'));
    const amounts = selling.map((q) => (q.status === 'ok' ? q.out.amount : 0));
    assert.deepEqual(amounts, [3066, 306_550, 1_532_750, 3_065_500]);
  });
});

describe('the adapter', () => {
  it('declares itself for the catalogue and covers one provider', () => {
    const adapter = createBitsoAdapter();
    assert.equal(adapter.id, 'bitso');
    assert.equal(adapter.kind, 'quote');
    assert.equal(adapter.mode, 'local');
    assert.deepEqual(adapter.providerIds, ['bitso']);
  });

  it('fetches once and returns eight rows', async () => {
    const { impl, calls } = stubFetch(TICKER);
    const adapter = createBitsoAdapter({
      fetchImpl: impl,
      userAgent: TEST_USER_AGENT,
      now: () => CAPTURED,
    });

    const rows = await adapter.fetchQuotes(BRACKETS);

    assert.equal(rows.length, 8);
    assert.deepEqual(calls, [BITSO_URL], 'one request for all eight rows');
  });

  it('returns only the brackets it was asked for', async () => {
    const { impl } = stubFetch(TICKER);
    const adapter = createBitsoAdapter({
      fetchImpl: impl,
      userAgent: TEST_USER_AGENT,
      now: () => CAPTURED,
    });

    const rows = await adapter.fetchQuotes([100, 1000]);
    assert.equal(rows.length, 4);
  });

  it('throws instead of returning rows when the source cannot be read', async () => {
    const { impl } = stubFetch({ success: false });
    const adapter = createBitsoAdapter({
      fetchImpl: impl,
      userAgent: TEST_USER_AGENT,
      ...{ maxAttempts: 1 },
    });

    // Art. I.2: no row of any kind from a source we could not read.
    await assert.rejects(() => adapter.fetchQuotes(BRACKETS), /did not report success/);
  });
});
