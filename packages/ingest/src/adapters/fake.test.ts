/**
 * Tests for the fake adapter (T007).
 *
 * Done criterion: it returns valid `Quote[]` for the four brackets, and covers
 * both of the paths Art. I.2 separates — `out_of_range`, which writes a row,
 * and a thrown failure, which writes none.
 *
 * "Valid" is checked against the shape the union actually demands, not eyeballed:
 * every `ok` row must carry both amounts, every `out_of_range` row must carry a
 * reason and no amounts.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Quote } from '../contract.ts';
import {
  createFakeQuoteAdapter,
  createThrowingQuoteAdapter,
  FAKE_BRACKETS,
  FakeAdapterFailure,
} from './fake.ts';

const BRACKETS = [...FAKE_BRACKETS];
const FIXED_CLOCK = () => '2026-09-13T17:00:00.000Z';

describe('the healthy fake', () => {
  it('returns eight rows: two directions across the four brackets', async () => {
    const adapter = createFakeQuoteAdapter({ now: FIXED_CLOCK });
    const quotes = await adapter.fetchQuotes(BRACKETS);

    assert.equal(quotes.length, 8);

    for (const direction of ['usd_to_cop', 'cop_to_usd'] as const) {
      const seen = quotes.filter((q) => q.direction === direction).map((q) => q.bracket_usd);
      assert.deepEqual(
        seen.sort((a, b) => a - b),
        BRACKETS,
        `${direction} covers every bracket`,
      );
    }
  });

  it('produces rows the Quote union accepts, with amounts only where earned', async () => {
    const adapter = createFakeQuoteAdapter({ now: FIXED_CLOCK });
    const quotes = await adapter.fetchQuotes(BRACKETS);

    for (const quote of quotes) {
      if (quote.status === 'ok') {
        // Narrowing gives these without a cast — the union does the work.
        assert.ok(quote.in.amount > 0, 'an ok row states what is handed over');
        assert.ok(quote.out.amount > 0, 'and what comes back');
      } else {
        assert.equal(quote.limit_reason, 'below_minimum');
        assert.equal(quote.in, undefined, 'never quoted, so never invented');
        assert.equal(quote.out, undefined);
      }
      assert.equal(quote.captured_at, '2026-09-13T17:00:00.000Z');
      assert.equal(quote.amounts_source, 'computed');
    }
  });

  it('puts the fixed side on the USD leg in both directions', async () => {
    const adapter = createFakeQuoteAdapter({ now: FIXED_CLOCK });
    const quotes = await adapter.fetchQuotes(BRACKETS);

    for (const quote of quotes) {
      const expected = quote.direction === 'usd_to_cop' ? 'in' : 'out';
      assert.equal(quote.fixed_side, expected);

      if (quote.status !== 'ok') continue;
      const usdLeg = quote.fixed_side === 'in' ? quote.in : quote.out;
      assert.equal(usdLeg.currency, 'USD');
      assert.equal(usdLeg.amount, quote.bracket_usd, 'the fixed side IS the bracket');
    }
  });

  it('marks the 1 USD bracket out_of_range in both directions', async () => {
    const adapter = createFakeQuoteAdapter({ now: FIXED_CLOCK });
    const quotes = await adapter.fetchQuotes(BRACKETS);

    const tiny = quotes.filter((q) => q.bracket_usd === 1);
    assert.equal(tiny.length, 2, 'both directions, not just one');
    for (const quote of tiny) {
      assert.equal(quote.status, 'out_of_range');
      assert.equal(quote.limit_reason, 'below_minimum');
    }

    const rest = quotes.filter((q) => q.bracket_usd !== 1);
    assert.equal(rest.length, 6);
    assert.ok(
      rest.every((q) => q.status === 'ok'),
      'everything at or above the minimum is a real quote',
    );
  });

  it('honours a different minimum', async () => {
    const adapter = createFakeQuoteAdapter({ minimumUsd: 600, now: FIXED_CLOCK });
    const quotes = await adapter.fetchQuotes(BRACKETS);

    const outOfRange = quotes.filter((q) => q.status === 'out_of_range').map((q) => q.bracket_usd);
    assert.deepEqual(
      outOfRange.sort((a, b) => a - b),
      [1, 1, 100, 100, 500, 500],
    );
  });

  it('returns only the brackets it was asked for', async () => {
    const adapter = createFakeQuoteAdapter({ now: FIXED_CLOCK });
    const quotes = await adapter.fetchQuotes([100, 1000]);

    assert.equal(quotes.length, 4);
    assert.deepEqual(
      [...new Set(quotes.map((q) => q.bracket_usd))].sort((a, b) => a - b),
      [100, 1000],
    );
  });

  it('routes its amounts through computeAmounts, fees and all', async () => {
    // Case B from the T006b golden set. If the fake diverged from the shared
    // function, this is where it would show.
    const adapter = createFakeQuoteAdapter({
      grossRate: 3080,
      feeFixedUsd: 21.4,
      minimumUsd: 5,
      now: FIXED_CLOCK,
    });
    const quotes = await adapter.fetchQuotes([500]);
    const forward = quotes.find((q) => q.direction === 'usd_to_cop');

    assert.ok(forward?.status === 'ok');
    assert.deepEqual(forward.in, { amount: 500, currency: 'USD' });
    assert.deepEqual(forward.out, { amount: 1_474_088, currency: 'COP' });
  });

  it('touches no network at all', async () => {
    // Not a claim about imports: fetch is replaced with a landmine and the
    // adapter still has to produce its eight rows.
    const realFetch = globalThis.fetch;
    globalThis.fetch = (() => {
      throw new Error('the fake adapter must never reach the network');
    }) as unknown as typeof fetch;

    try {
      const adapter = createFakeQuoteAdapter({ now: FIXED_CLOCK });
      const quotes = await adapter.fetchQuotes(BRACKETS);
      assert.equal(quotes.length, 8);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

describe('the failing fake', () => {
  it('throws, and produces no rows of any kind', async () => {
    const adapter = createThrowingQuoteAdapter();

    let rows: Quote[] | undefined;
    await assert.rejects(
      async () => {
        rows = await adapter.fetchQuotes(BRACKETS);
      },
      (error: unknown) => {
        assert.ok(error instanceof FakeAdapterFailure);
        return true;
      },
    );

    // The point of Art. I.2: a source we could not ask writes nothing. Not an
    // empty array, not a row marked failed — nothing. Absence in `quotes` has
    // to mean real absence, or the silence alarm in T019 is meaningless.
    assert.equal(rows, undefined);
  });

  it('still declares itself as a quote adapter', () => {
    const adapter = createThrowingQuoteAdapter({ id: 'broken_source' });
    assert.equal(adapter.kind, 'quote');
    assert.equal(adapter.id, 'broken_source');
  });
});
