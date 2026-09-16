/**
 * Tests for the El Dorado adapter (T015).
 *
 * Against real quotes saved on 2026-09-13, with no network (Art. VII.3).
 *
 * Three things get pinned by value, because all three fail silently:
 *   1. `rate` lands in `fee_pct` and `value` in `fee_amount_usd` — at bracket
 *      100 they are 0.0099 and 0.9999, similar enough to look interchangeable.
 *   2. The 1 USD bracket is an `ok` row at a punitive price, not out_of_range.
 *   3. The spread assertion (plan.md §3, rule 6).
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { TEST_USER_AGENT } from '../http.ts';
import {
  createEldoradoAdapter,
  ELDORADO_METHODS,
  ELDORADO_QUOTE_URL,
  type EldoradoQuoteResponse,
  parseQuote,
  quoteBody,
  toRow,
} from './eldorado.ts';

const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures');

function fixture(name: string): EldoradoQuoteResponse {
  return JSON.parse(readFileSync(resolve(FIXTURES, name), 'utf8')) as EldoradoQuoteResponse;
}

const BUY_100 = fixture('eldorado-quote-buy-100-2026-09-13.json');
const SELL_100 = fixture('eldorado-quote-sell-100-2026-09-13.json');
const BUY_1 = fixture('eldorado-quote-buy-1-2026-09-13.json');

const CAPTURED = '2026-09-13T21:30:00.000Z';
const METHOD = 'bank_bancolombia';

describe('the two fee fields go to their own columns', () => {
  it('rate becomes fee_pct and value becomes fee_amount_usd', () => {
    const parsed = parseQuote(BUY_100, 'cop_to_usd', 100);

    assert.equal(parsed.feePct, 0.0099, 'the fraction');

    // Eldorado sends "0.999899000100999899" — eighteen decimals, more than a
    // float64 holds, so Number() lands on 0.9998990001009999. Harmless here:
    // fee_amount_usd is numeric(12,4) and stores 0.9999 either way. Recorded
    // because it is a real narrowing at the boundary, not a typo.
    assert.equal(parsed.feeAmountUsd, 0.9998990001009999, 'the absolute USDT amount');

    // The pair that makes the mistake plausible: same order of magnitude,
    // a hundredfold apart in meaning.
    assert.ok(parsed.feeAmountUsd / parsed.feePct > 50, 'they are not the same number');
  });

  it('lands them on the row the same way round', () => {
    const row = toRow(
      parseQuote(BUY_100, 'cop_to_usd', 100),
      BUY_100,
      'cop_to_usd',
      100,
      METHOD,
      CAPTURED,
    );

    assert.equal(row.fee_pct, 0.0099);
    assert.equal(row.fee_amount_usd, 0.9998990001009999);
    assert.equal(row.fee_fixed_usd, undefined, 'the source never states a separate fixed fee');
  });

  it('the selling side charges a different rate, and it is read as such', () => {
    const parsed = parseQuote(SELL_100, 'usd_to_cop', 100);
    assert.equal(parsed.feePct, 0.0123, 'not symmetric with the 0.0099 buying side');
  });

  it('refuses a fee block it cannot read', () => {
    const noFees: EldoradoQuoteResponse = {
      data: { quote: { ...BUY_100.data?.quote, fees: { total: [] } } },
    };
    assert.throws(() => parseQuote(noFees, 'cop_to_usd', 100), /no fees\.total|states no fees/);
  });
});

describe('amounts come from the provider, untouched', () => {
  it('reads the fixed USD side and the variable COP side', () => {
    const buying = parseQuote(BUY_100, 'cop_to_usd', 100);
    assert.equal(buying.usdAmount, 100);
    assert.equal(buying.amountInCop, 312_897.69);

    const selling = parseQuote(SELL_100, 'usd_to_cop', 100);
    assert.equal(selling.usdAmount, 100);
    assert.equal(selling.amountOutCop, 297_646.45);
  });

  it('marks the row amounts_source provider', () => {
    const row = toRow(
      parseQuote(BUY_100, 'cop_to_usd', 100),
      BUY_100,
      'cop_to_usd',
      100,
      METHOD,
      CAPTURED,
    );
    assert.equal(row.amounts_source, 'provider');
  });

  it('refuses a quote that fixed a different side than we asked', () => {
    // The numbers would mean something other than what we are about to record.
    assert.throws(() => parseQuote(BUY_100, 'usd_to_cop', 100), /asked to fix IN/);
    assert.throws(() => parseQuote(SELL_100, 'cop_to_usd', 100), /asked to fix OUT/);
  });

  it('refuses a quote for an amount other than the bracket asked for', () => {
    assert.throws(() => parseQuote(BUY_100, 'cop_to_usd', 500), /asked for 500 USD/);
  });
});

describe('the 1 USD bracket is expensive, not out of range', () => {
  it('produces an ok row with a real price', () => {
    const row = toRow(parseQuote(BUY_1, 'cop_to_usd', 1), BUY_1, 'cop_to_usd', 1, METHOD, CAPTURED);

    assert.equal(row.status, 'ok', 'the provider quoted it — it is an observation');
    assert.equal(row.limit_reason, undefined);
    assert.ok(row.status === 'ok');
    assert.deepEqual(row.in, { amount: 5215, currency: 'COP' });
    assert.deepEqual(row.out, { amount: 1, currency: 'USD' });
  });

  it('shows the fee floor doing the damage, which is the point of HU-04', () => {
    const tiny = parseQuote(BUY_1, 'cop_to_usd', 1);
    const hundred = parseQuote(BUY_100, 'cop_to_usd', 100);

    assert.equal(tiny.feeAmountUsd, 0.49, 'the 0.49 USDT floor');
    assert.ok(tiny.feePct > 0.3, `${tiny.feePct} — a third of the trade`);

    // 5,215 against 3,129 COP per USDT. The number says it better than a label.
    assert.ok(
      tiny.grossRate > hundred.grossRate * 1.5,
      `${tiny.grossRate} should be far worse than ${hundred.grossRate}`,
    );
  });
});

describe('the request body', () => {
  it('fixes the USD side in both directions', () => {
    const buying = quoteBody('cop_to_usd', 100, METHOD) as Record<string, unknown>;
    assert.equal(buying['fixedSide'], 'OUT', 'wanting 100 USD fixes the output');
    assert.equal(buying['amount'], '100');

    const selling = quoteBody('usd_to_cop', 100, METHOD) as Record<string, unknown>;
    assert.equal(selling['fixedSide'], 'IN', 'handing over 100 USD fixes the input');
  });

  it('puts the payment method on the COP leg, whichever leg that is', () => {
    const buying = quoteBody('cop_to_usd', 100, METHOD) as { in: { paymentMethodId?: string } };
    assert.equal(buying.in.paymentMethodId, METHOD);

    const selling = quoteBody('usd_to_cop', 100, METHOD) as { out: { paymentMethodId?: string } };
    assert.equal(selling.out.paymentMethodId, METHOD);
  });
});

describe('the spread assertion (plan.md §3, rule 6)', () => {
  it('buying costs more than selling yields', () => {
    const buying = toRow(
      parseQuote(BUY_100, 'cop_to_usd', 100),
      BUY_100,
      'cop_to_usd',
      100,
      METHOD,
      CAPTURED,
    );
    const selling = toRow(
      parseQuote(SELL_100, 'usd_to_cop', 100),
      SELL_100,
      'usd_to_cop',
      100,
      METHOD,
      CAPTURED,
    );

    assert.ok(buying.status === 'ok' && selling.status === 'ok');
    assert.ok(
      buying.in.amount > selling.out.amount,
      `paying ${buying.in.amount} must exceed receiving ${selling.out.amount}`,
    );
    // 15,251.24 in decimal; the float subtraction lands a hair below.
    assert.ok(Math.abs(buying.in.amount - selling.out.amount - 15_251.24) < 0.01);
  });

  it('keeps the provider’s own decimals, unlike the computed adapters', () => {
    // bitso, buda and dolarapp go through computeAmounts(), which rounds COP to
    // the integer because the peso has no cents. Eldorado does not: its amounts
    // are its own (amounts_source: 'provider'), and rounding someone else's
    // stated number would be editing it. The inconsistency is deliberate.
    const buying = toRow(
      parseQuote(BUY_100, 'cop_to_usd', 100),
      BUY_100,
      'cop_to_usd',
      100,
      METHOD,
      CAPTURED,
    );
    assert.ok(buying.status === 'ok');
    assert.equal(buying.in.amount, 312_897.69);
    assert.ok(!Number.isInteger(buying.in.amount), 'not rounded on the way in');
  });
});

describe('fixed_side per direction', () => {
  it('the fixed leg is USD and equals the bracket', () => {
    for (const [body, direction, bracket] of [
      [BUY_100, 'cop_to_usd', 100],
      [SELL_100, 'usd_to_cop', 100],
      [BUY_1, 'cop_to_usd', 1],
    ] as const) {
      const row = toRow(
        parseQuote(body, direction, bracket),
        body,
        direction,
        bracket,
        METHOD,
        CAPTURED,
      );
      assert.ok(row.status === 'ok');

      const fixed = row.fixed_side === 'in' ? row.in : row.out;
      assert.equal(row.fixed_side, direction === 'usd_to_cop' ? 'in' : 'out');
      assert.equal(fixed.currency, 'USD');
      assert.equal(fixed.amount, bracket);
    }
  });
});

describe('the adapter, and the row count that is not eight', () => {
  it('declares four payment methods as a constant, not a discovery', () => {
    assert.deepEqual(
      [...ELDORADO_METHODS],
      ['bank_bancolombia', 'app_nequi_co', 'app_daviplata_co', 'app_llave_co'],
    );
  });

  it('produces 32 rows: 4 methods x 4 brackets x 2 directions', async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const impl = (async (url: string | URL | Request, init?: RequestInit) => {
      const sent = JSON.parse(String(init?.body)) as { fixedSide: string; amount: string };
      calls.push({ url: String(url), body: sent });
      const source = sent.fixedSide === 'OUT' ? (sent.amount === '1' ? BUY_1 : BUY_100) : SELL_100;
      // Re-stamp so the fixture matches whichever bracket was asked for.
      const cloned = JSON.parse(JSON.stringify(source)) as EldoradoQuoteResponse;
      const quote = cloned.data?.quote;
      if (quote !== undefined) {
        const usdSide = sent.fixedSide === 'OUT' ? quote.amountOut : quote.amountIn;
        if (usdSide !== undefined) usdSide.value = sent.amount;
      }
      return new Response(JSON.stringify(cloned), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const rows = await createEldoradoAdapter({
      fetchImpl: impl,
      userAgent: TEST_USER_AGENT,
      now: () => CAPTURED,
    }).fetchQuotes([1, 100, 500, 1000]);

    assert.equal(rows.length, 32, 'not 8 — this is the one that multiplies by method');
    assert.equal(calls.length, 32, 'one POST per row');
    assert.ok(
      calls.every((c) => c.url === ELDORADO_QUOTE_URL),
      'and never a call to /methods',
    );

    // Every combination present exactly once.
    const keys = rows.map((r) => `${r.direction}|${r.bracket_usd}|${r.payment_method}`);
    assert.equal(new Set(keys).size, 32);

    for (const method of ELDORADO_METHODS) {
      assert.equal(rows.filter((r) => r.payment_method === method).length, 8, method);
    }
  });

  it('carries the catalogue identity and the method on every row', async () => {
    const impl = (async (_url: string | URL | Request, init?: RequestInit) => {
      const sent = JSON.parse(String(init?.body)) as { fixedSide: string };
      return new Response(JSON.stringify(sent.fixedSide === 'OUT' ? BUY_100 : SELL_100), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const rows = await createEldoradoAdapter({
      fetchImpl: impl,
      userAgent: TEST_USER_AGENT,
      now: () => CAPTURED,
      methods: ['bank_bancolombia'],
    }).fetchQuotes([100]);

    assert.equal(rows.length, 2, 'both directions for one method at one bracket');
    for (const row of rows) {
      assert.equal(row.provider_id, 'eldorado');
      assert.equal(row.mode, 'local');
      assert.equal(row.asset, 'usdt');
      assert.equal(row.channel, 'p2p');
      assert.equal(row.payment_method, 'bank_bancolombia');
      assert.equal(row.captured_at, CAPTURED);
    }
  });

  it('throws rather than record a row when a quote comes back unreadable', async () => {
    // Art. I.2: a source we could not read writes nothing at all.
    const impl = (async () =>
      new Response(JSON.stringify({ data: {} }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as unknown as typeof fetch;

    const adapter = createEldoradoAdapter({
      fetchImpl: impl,
      userAgent: TEST_USER_AGENT,
      maxAttempts: 1,
      methods: ['bank_bancolombia'],
    });
    await assert.rejects(() => adapter.fetchQuotes([100]), /no quote/);
  });

  it('covers one provider', () => {
    assert.deepEqual(createEldoradoAdapter().providerIds, ['eldorado']);
  });
});
