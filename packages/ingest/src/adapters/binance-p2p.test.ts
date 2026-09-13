/**
 * Tests for the Binance P2P adapter (T016).
 *
 * Against real ad books saved on 2026-09-13, with no network (Art. VII.3).
 *
 * **The golden case for the weighted price is deliberately missing.** Its
 * expected value is computed by hand by the human, not derived from this code —
 * a golden case produced by the implementation it checks proves only that the
 * code agrees with itself (Art. VII.1, and the lesson of T006b). It is marked
 * `todo` below and stays that way until the number arrives.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  BINANCE_P2P_URL,
  type BinanceResponse,
  buildQuote,
  createBinanceP2pAdapter,
  type Offer,
  parseOffers,
  RAW_TOP_N,
  tradeTypeFor,
  walkBook,
} from './binance-p2p.ts';

const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures');
const BUY = JSON.parse(
  readFileSync(resolve(FIXTURES, 'binance-p2p-buy-cop-2026-09-13.json'), 'utf8'),
) as BinanceResponse;
const SELL = JSON.parse(
  readFileSync(resolve(FIXTURES, 'binance-p2p-sell-cop-2026-09-13.json'), 'utf8'),
) as BinanceResponse;

const CAPTURED = '2026-09-13T21:45:00.000Z';

describe('tradeType is inverted, and nothing reads the ads to decide', () => {
  it('sends the user side, which is the opposite of what the ads report', () => {
    assert.equal(tradeTypeFor('cop_to_usd'), 'BUY', 'wanting USDT sends BUY');
    assert.equal(tradeTypeFor('usd_to_cop'), 'SELL', 'handing over USDT sends SELL');
  });

  it('the fixtures confirm the inversion on real data', () => {
    // Asked BUY, every ad says SELL. This is why no code path reads
    // adv.tradeType: the request decides what the numbers mean.
    const buyAd = (BUY.data ?? [])[0] as { adv?: { tradeType?: string } };
    const sellAd = (SELL.data ?? [])[0] as { adv?: { tradeType?: string } };
    assert.equal(buyAd.adv?.tradeType, 'SELL');
    assert.equal(sellAd.adv?.tradeType, 'BUY');
  });
});

describe('reading the book', () => {
  it('parses twenty usable offers from each direction', () => {
    assert.equal(parseOffers(BUY).length, 20);
    assert.equal(parseOffers(SELL).length, 20);
  });

  it('converts each minimum from COP into USDT', () => {
    const first = parseOffers(BUY)[0];
    assert.ok(first !== undefined);
    // Ad #1: 500,000 COP minimum at 3075.60 = about 162.6 USDT.
    assert.ok(Math.abs(first.minUsdt - 500_000 / 3075.6) < 0.001);
  });

  it('skips a malformed ad instead of failing the whole source', () => {
    // Hundreds of ads are live; one broken entry should not darken the
    // provider for the run.
    const withJunk: BinanceResponse = {
      data: [{ adv: { price: 'n/d' } }, ...(BUY.data ?? [])],
    };
    assert.equal(parseOffers(withJunk).length, 20);
  });

  it('throws when nothing in the response is readable', () => {
    assert.throws(() => parseOffers({}), /no ad list/);
    assert.throws(() => parseOffers({ data: [{ adv: { price: '0' } }] }), /no readable ads/);
  });
});

describe('the eligibility filter, which the plan did not specify', () => {
  it('drops ads whose minimum exceeds the bracket', () => {
    const offers = parseOffers(BUY);
    const eligible = offers.filter((o) => o.minUsdt <= 100);

    assert.equal(eligible.length, 7, '7 of 20 accept a 100 USD trade');
    assert.ok(
      offers[0] !== undefined && offers[0].minUsdt > 100,
      'and the cheapest ad is not one of them — it wants ~162 USDT minimum',
    );
  });

  it('counting the ineligible ads would flatter Binance', () => {
    // The excluded ads are the cheap ones, so ignoring the filter produces a
    // weighted price better than anything actually reachable.
    const offers = parseOffers(BUY);
    const naive = walkBook(
      offers.map((o) => ({ ...o, minUsdt: 0 })),
      100,
    );
    const honest = walkBook(offers, 100);

    assert.ok(naive.kind === 'ok' && honest.kind === 'ok');
    assert.ok(
      naive.weightedPrice < honest.weightedPrice,
      'the naive walk buys cheaper than a person could',
    );
  });
});

describe('below_minimum, which fires every single run', () => {
  it('the 1 USD bracket has no eligible ad in either direction', () => {
    assert.deepEqual(walkBook(parseOffers(BUY), 1), { kind: 'below_minimum' });
    assert.deepEqual(walkBook(parseOffers(SELL), 1), { kind: 'below_minimum' });
  });

  it('produces an out_of_range row with the reason and no amounts', () => {
    const row = buildQuote(walkBook(parseOffers(BUY), 1), {}, 'cop_to_usd', 1, CAPTURED);

    assert.equal(row.status, 'out_of_range');
    assert.equal(row.limit_reason, 'below_minimum');
    assert.equal(row.in, undefined, 'nothing was quoted, so nothing is recorded');
    assert.equal(row.out, undefined);
    assert.equal(row.gross_rate, undefined);
  });
});

describe('insufficient_liquidity, tested on a truncated book on purpose', () => {
  // With 260 and 347 ads live this branch will essentially never fire by
  // itself. A branch that is never exercised is a branch nobody has checked,
  // so the book is cut down deliberately rather than left to chance.
  const thin: Offer[] = [
    { price: 3080, minUsdt: 10, maxUsdt: 50 },
    { price: 3085, minUsdt: 10, maxUsdt: 30 },
  ];

  it('fires when the eligible ads together cannot cover the bracket', () => {
    const walk = walkBook(thin, 500);
    assert.equal(walk.kind, 'insufficient_liquidity');
    assert.ok(walk.kind === 'insufficient_liquidity');
    assert.equal(walk.eligibleCapacity, 80);
  });

  it('does not fire when they can', () => {
    assert.equal(walkBook(thin, 80).kind, 'ok');
  });

  it('counts only the eligible ads towards capacity', () => {
    // A huge ad that will not take our amount is not capacity we have.
    const withBigMinimum: Offer[] = [...thin, { price: 3070, minUsdt: 900, maxUsdt: 100_000 }];
    const walk = walkBook(withBigMinimum, 500);
    assert.ok(walk.kind === 'insufficient_liquidity');
    assert.equal(walk.eligibleCapacity, 80, 'the 100,000 USDT ad does not count');
  });

  it('produces an out_of_range row with its own reason', () => {
    const row = buildQuote(walkBook(thin, 500), {}, 'cop_to_usd', 500, CAPTURED);
    assert.equal(row.status, 'out_of_range');
    assert.equal(row.limit_reason, 'insufficient_liquidity');
  });
});

describe('the weighted walk', () => {
  it('weights by the amount actually taken from each ad', () => {
    // Structural, not a golden case: two ads, and the bracket takes all of the
    // first and half of the second, so the weighting is 50/50 by construction.
    const book: Offer[] = [
      { price: 3000, minUsdt: 0, maxUsdt: 100 },
      { price: 3100, minUsdt: 0, maxUsdt: 200 },
    ];
    const walk = walkBook(book, 200);

    assert.ok(walk.kind === 'ok');
    assert.equal(walk.filled, 200);
    assert.equal(walk.adsUsed, 2);
    assert.equal(walk.weightedPrice, 3050);
  });

  it('uses one ad when one ad is enough', () => {
    const walk = walkBook([{ price: 3080, minUsdt: 0, maxUsdt: 5000 }], 100);
    assert.ok(walk.kind === 'ok');
    assert.equal(walk.adsUsed, 1);
    assert.equal(walk.weightedPrice, 3080, 'a weighted average of one price is that price');
  });

  it('does not reorder the book', () => {
    // The list arrives best-first for the side requested. Re-sorting would
    // quietly override Binance's own notion of which offer leads.
    const book: Offer[] = [
      { price: 3100, minUsdt: 0, maxUsdt: 50 },
      { price: 3000, minUsdt: 0, maxUsdt: 50 },
    ];
    const walk = walkBook(book, 50);
    assert.ok(walk.kind === 'ok');
    assert.equal(walk.weightedPrice, 3100, 'took the first listed, not the cheapest');
  });

  it.todo(
    'GOLDEN: the weighted price for BUY bracket 100, hand-computed by the human — ' +
      'pending the number, over the eligible ads of binance-p2p-buy-cop-2026-09-13.json',
  );
});

describe('the adapter', () => {
  function router() {
    const sent: Array<{ tradeType: string }> = [];
    const impl = (async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { tradeType: string };
      sent.push(body);
      return new Response(JSON.stringify(body.tradeType === 'BUY' ? BUY : SELL), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;
    return { impl, sent };
  }

  it('makes two calls and returns eight rows', async () => {
    const { impl, sent } = router();
    const rows = await createBinanceP2pAdapter({
      fetchImpl: impl,
      now: () => CAPTURED,
    }).fetchQuotes([1, 100, 500, 1000]);

    assert.equal(rows.length, 8);
    assert.equal(sent.length, 2, 'one page per direction, not one per bracket');
    assert.deepEqual(
      sent.map((s) => s.tradeType),
      ['SELL', 'BUY'],
    );
  });

  it('keeps only the top ads in raw', async () => {
    const { impl } = router();
    const rows = await createBinanceP2pAdapter({
      fetchImpl: impl,
      now: () => CAPTURED,
    }).fetchQuotes([100]);

    const raw = rows[0]?.raw as { top: unknown[]; kept: number };
    assert.equal(raw.top.length, RAW_TOP_N);
    assert.equal(raw.kept, RAW_TOP_N);
  });

  it('marks the 1 USD bracket out_of_range and the rest ok', async () => {
    const { impl } = router();
    const rows = await createBinanceP2pAdapter({
      fetchImpl: impl,
      now: () => CAPTURED,
    }).fetchQuotes([1, 100, 500, 1000]);

    const tiny = rows.filter((r) => r.bracket_usd === 1);
    assert.equal(tiny.length, 2);
    assert.ok(tiny.every((r) => r.status === 'out_of_range' && r.limit_reason === 'below_minimum'));

    assert.ok(rows.filter((r) => r.bracket_usd !== 1).every((r) => r.status === 'ok'));
  });

  // BLOQUEADO por una contradicción con plan.md §3 regla 6, pendiente de
  // decisión humana. Medido sobre el fixture del 2026-09-13: en el bracket 500
  // vender rinde 1.540.500 COP y comprar cuesta 1.539.867 — 633 COP invertidos.
  // No es un defecto del adapter: P2P son dos mercados con contrapartes y
  // mínimos distintos, y la regla se escribió pensando en libros de exchange.
  // Marcado `todo` en vez de recortado a los brackets que pasan, para que la
  // suite no afirme algo que no comprobó.
  it.todo('the spread assertion (plan.md §3, rule 6) — inverted at bracket 500, see above');

  it('records the inversion as measured, so it cannot be quietly forgotten', async () => {
    const { impl } = router();
    const rows = await createBinanceP2pAdapter({
      fetchImpl: impl,
      now: () => CAPTURED,
    }).fetchQuotes([100, 500, 1000]);

    const gap = (bracket: number): number => {
      const selling = rows.find((r) => r.direction === 'usd_to_cop' && r.bracket_usd === bracket);
      const buying = rows.find((r) => r.direction === 'cop_to_usd' && r.bracket_usd === bracket);
      assert.ok(selling?.status === 'ok' && buying?.status === 'ok');
      return buying.in.amount - selling.out.amount;
    };

    assert.ok(gap(100) > 0, 'holds at bracket 100');
    assert.ok(gap(1000) > 0, 'holds at bracket 1000');
    assert.ok(gap(500) < 0, 'and does NOT hold at 500 — about 633 COP the other way');
  });

  it('the fixed leg is USD and equals the bracket', async () => {
    const { impl } = router();
    const rows = await createBinanceP2pAdapter({
      fetchImpl: impl,
      now: () => CAPTURED,
    }).fetchQuotes([100, 1000]);

    for (const row of rows) {
      assert.ok(row.status === 'ok');
      const fixed = row.fixed_side === 'in' ? row.in : row.out;
      assert.equal(row.fixed_side, row.direction === 'usd_to_cop' ? 'in' : 'out');
      assert.equal(fixed.currency, 'USD');
      assert.equal(fixed.amount, row.bracket_usd);
    }
  });

  it('calls the documented URL and covers one provider', async () => {
    const adapter = createBinanceP2pAdapter();
    assert.deepEqual(adapter.providerIds, ['binance_p2p']);
    assert.equal(BINANCE_P2P_URL, 'https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search');
  });
});
