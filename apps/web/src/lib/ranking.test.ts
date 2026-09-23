/**
 * Tests for the ranking (T025 partial).
 *
 * The rule under test is Art. III.1, and the way to get it wrong is subtle:
 * sorting by the advertised rate looks right in both directions and is wrong in
 * one of them. Measured on real data, Wise showed the best advertised margin of
 * eleven providers and delivered the worst amount, in the same row.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { LatestQuote } from './quotes.ts';
import {
  assetLabel,
  availableSelections,
  betterIsHigher,
  comparableAmount,
  crossAtBracket,
  limitReasonLabel,
  modeHint,
  modeLabel,
  REMITTANCE_ORIGIN_COUNTRY,
  REMITTANCE_ORIGIN_LABEL,
  rank,
  select,
} from './ranking.ts';

function quote(overrides: Partial<LatestQuote>): LatestQuote {
  return {
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
    amount_out: 300_000,
    currency_out: 'COP',
    status: 'ok',
    limit_reason: null,
    gross_rate: 3000,
    effective_rate: 3000,
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
    markup_vs_trm: 0.01,
    markup_vs_mid: 0.01,
    ...overrides,
  };
}

describe('selling: more pesos wins', () => {
  // fixed_side 'in' — the person hands over 100 USD and receives pesos.

  it('puts the biggest amount_out first', () => {
    const { rows } = rank(
      [
        quote({ provider_id: 'buda', amount_out: 298_000 }),
        quote({ provider_id: 'bitso', amount_out: 306_550 }),
        quote({ provider_id: 'wise', amount_out: 280_444 }),
      ],
      'best-method',
    );

    assert.deepEqual(
      rows.map((r) => r.quote.provider_id),
      ['bitso', 'buda', 'wise'],
    );
    assert.deepEqual(
      rows.map((r) => r.position),
      [1, 2, 3],
    );
  });

  it('measures the gap in pesos, from the leader', () => {
    const { rows } = rank(
      [
        quote({ provider_id: 'bitso', amount_out: 306_550 }),
        quote({ provider_id: 'buda', amount_out: 298_000 }),
      ],
      'best-method',
    );

    assert.equal(rows[0]?.behindBy, 0);
    assert.equal(rows[1]?.behindBy, 8_550);
  });

  it('does NOT rank by the advertised rate', () => {
    // The whole of Art. III.1 in one case, from real measurements: Wise
    // advertises the best rate of the three and pays the least, because its
    // fee is charged separately.
    const { rows } = rank(
      [
        quote({ provider_id: 'wise', gross_rate: 3087.23, amount_out: 280_444 }),
        quote({ provider_id: 'binance_p2p', gross_rate: 3085.0, amount_out: 308_500 }),
      ],
      'best-method',
    );

    assert.equal(rows[0]?.quote.provider_id, 'binance_p2p');
    assert.ok(
      (rows[0]?.quote.gross_rate ?? 0) < (rows[1]?.quote.gross_rate ?? 0),
      'the winner advertises the WORSE rate, and still wins',
    );
  });
});

describe('buying: fewer pesos wins', () => {
  // fixed_side 'out' — the person wants 100 USD and pays pesos.

  const buying = (provider: string, pesos: number) =>
    quote({
      provider_id: provider,
      direction: 'cop_to_usd',
      fixed_side: 'out',
      amount_in: pesos,
      currency_in: 'COP',
      amount_out: 100,
      currency_out: 'USD',
    });

  it('puts the smallest amount_in first', () => {
    const { rows } = rank([buying('buda', 320_000), buying('bitso', 307_970)], 'best-method');

    assert.deepEqual(
      rows.map((r) => r.quote.provider_id),
      ['bitso', 'buda'],
    );
    assert.equal(rows[1]?.behindBy, 12_030);
  });

  it('knows which side is variable from fixed_side, not from the direction name', () => {
    assert.equal(betterIsHigher('in'), true);
    assert.equal(betterIsHigher('out'), false);
    assert.equal(comparableAmount(buying('bitso', 307_970)), 307_970);
  });

  it('inverting the order would put the most expensive first — the failure to avoid', () => {
    const { rows } = rank([buying('caro', 400_000), buying('barato', 300_000)], 'best-method');
    assert.equal(rows[0]?.quote.provider_id, 'barato');
  });
});

describe('rows with no amount stay visible', () => {
  it('keeps out_of_range out of the order but not off the page', () => {
    // HU-04: "does not accept amounts that small" is an answer. Dropping the
    // row makes the provider look absent rather than unavailable at that size.
    const { rows, outOfRange } = rank(
      [
        quote({ provider_id: 'bitso', amount_out: 306_550 }),
        quote({
          provider_id: 'binance_p2p',
          status: 'out_of_range',
          limit_reason: 'below_minimum',
          amount_in: null,
          amount_out: null,
        }),
      ],
      'best-method',
    );

    assert.equal(rows.length, 1);
    assert.equal(outOfRange.length, 1);
    assert.equal(outOfRange[0]?.limit_reason, 'below_minimum');
  });

  it('says the reason in words a reader can act on', () => {
    assert.equal(limitReasonLabel('below_minimum'), 'no acepta montos tan chicos');
    assert.equal(limitReasonLabel('insufficient_liquidity'), 'no hay suficiente oferta');
  });
});

describe('Eldorado is set aside, not quietly included', () => {
  const withEldorado = [
    quote({ provider_id: 'bitso', amount_out: 306_550 }),
    quote({ provider_id: 'eldorado', payment_method: 'bank_bancolombia', amount_out: 312_000 }),
    quote({ provider_id: 'eldorado', payment_method: 'app_nequi_co', amount_out: 311_000 }),
  ];

  it('defers its rows while the decision is open', () => {
    // Including them IS the all-methods policy, chosen by accident. That is
    // the failure working rule 4 exists to prevent.
    const { rows, deferred } = rank(withEldorado, undefined);

    assert.deepEqual(
      rows.map((r) => r.quote.provider_id),
      ['bitso'],
    );
    assert.equal(deferred.length, 2);
  });

  it('does not let a deferred provider take the lead by accident', () => {
    // Eldorado pays more here. Under an undecided policy it must not appear as
    // the winner, because nobody decided it is comparable yet.
    const { rows } = rank(withEldorado, undefined);
    assert.equal(rows[0]?.quote.provider_id, 'bitso');
  });

  it('ranks it once a policy is given', () => {
    const { rows, deferred } = rank(withEldorado, 'all-methods');

    assert.equal(deferred.length, 0);
    assert.equal(rows.length, 3);
    assert.equal(rows[0]?.quote.provider_id, 'eldorado');
  });
});

describe('the Eldorado policy, decided 2026-09-21 as best-method', () => {
  /**
   * The week said the four methods do NOT collapse: 3.710 of 6.512 cells
   * priced differently, spreads up to 4,38 %. So the policy had to be one that
   * does not pretend they are one number, and `best-method` names the method on
   * the row instead of averaging four that are four percent apart.
   *
   * These tests pin the behaviour AND the reason, because a policy that only
   * pins behaviour survives being swapped for another that behaves the same on
   * the fixture — the lesson the FROZEN_PRICE_HOURS mutation taught in T029.
   */
  const selling = [
    quote({ provider_id: 'bitso', amount_out: 306_550 }),
    quote({ provider_id: 'eldorado', payment_method: 'bank_bancolombia', amount_out: 312_000 }),
    quote({ provider_id: 'eldorado', payment_method: 'app_nequi_co', amount_out: 299_000 }),
    quote({ provider_id: 'eldorado', payment_method: 'app_llave_co', amount_out: 305_000 }),
  ];

  it('collapses the four methods to one row', () => {
    const { rows, deferred } = rank(selling, 'best-method');

    assert.equal(deferred.length, 0, 'the decision is taken; nothing is deferred now');
    assert.equal(
      rows.filter((r) => r.quote.provider_id === 'eldorado').length,
      1,
      'four of eleven positions for one provider is what all-methods would do',
    );
  });

  it('keeps the best-priced method, judged by the amount and not by the rate', () => {
    const { rows } = rank(selling, 'best-method');
    const mine = rows.find((r) => r.quote.provider_id === 'eldorado');

    assert.equal(mine?.quote.payment_method, 'bank_bancolombia');
    assert.equal(mine?.quote.amount_out, 312_000);
  });

  it('names the method, so the number is attributable', () => {
    const { rows } = rank(selling, 'best-method');
    const mine = rows.find((r) => r.quote.provider_id === 'eldorado');
    assert.ok(mine?.quote.payment_method, 'a row with no method named is not attributable');
  });

  it('best means fewest pesos when buying, not most', () => {
    // The direction flips what "best" means, and a policy that hard-coded
    // "highest amount" would silently pick the worst method on half the site.
    const buying = [
      quote({ provider_id: 'bitso', fixed_side: 'out', amount_in: 310_000, amount_out: 100 }),
      quote({
        provider_id: 'eldorado',
        payment_method: 'bank_bancolombia',
        fixed_side: 'out',
        amount_in: 320_000,
        amount_out: 100,
      }),
      quote({
        provider_id: 'eldorado',
        payment_method: 'app_nequi_co',
        fixed_side: 'out',
        amount_in: 305_000,
        amount_out: 100,
      }),
    ];

    const { rows } = rank(buying, 'best-method');
    const mine = rows.find((r) => r.quote.provider_id === 'eldorado');
    assert.equal(mine?.quote.payment_method, 'app_nequi_co');
    assert.equal(mine?.quote.amount_in, 305_000);
  });

  it('all-methods still keeps every one, for when the choice is revisited', () => {
    const { rows } = rank(selling, 'all-methods');
    assert.equal(rows.filter((r) => r.quote.provider_id === 'eldorado').length, 3);
  });

  it('fixed-method refuses instead of picking a method nobody chose', () => {
    // Rule 4: mark what is undecided, never fill it with a provisional value.
    // Which method it would be was never decided, so selecting this policy is
    // an error rather than a silent default.
    assert.throws(() => rank(selling, 'fixed-method'), /method chosen first/);
  });

  it('shows every method as unavailable rather than hiding the provider', () => {
    // All four out of range at this bracket: HU-04 says "no alcanza el mínimo"
    // is an answer, and collapsing to one row must not turn it into absence.
    const none = [
      quote({ provider_id: 'bitso', amount_out: 306_550 }),
      quote({
        provider_id: 'eldorado',
        payment_method: 'bank_bancolombia',
        status: 'out_of_range',
        limit_reason: 'below_minimum',
        amount_in: null,
        amount_out: null,
      }),
      quote({
        provider_id: 'eldorado',
        payment_method: 'app_nequi_co',
        status: 'out_of_range',
        limit_reason: 'below_minimum',
        amount_in: null,
        amount_out: null,
      }),
    ];

    const { rows, outOfRange } = rank(none, 'best-method');
    assert.equal(rows.length, 1, 'only bitso can be ranked');
    assert.equal(outOfRange.length, 2, 'both unavailable methods stay visible');
  });
});

describe('the Binance P2P cross, explained since 2026-09-21', () => {
  /**
   * The cross is: at the same bracket, selling the dollars pays more pesos than
   * buying them costs. Measured over the closing week at **572 of 2.386
   * comparable cells, 24 %**, spread evenly across brackets — 23 %, 23 %, 26 %.
   * Three runs on 2026-09-14 had suggested it was concentrated in the large
   * brackets; a week says otherwise.
   *
   * It is a real property of a peer-to-peer book, not a defect of ours, and at
   * 24 % a reader meets it often enough that leaving it unexplained reads as
   * the comparator being broken. Hence decision #3, `explain`.
   */
  const sell = (amountOut: number) =>
    quote({
      provider_id: 'binance_p2p',
      direction: 'usd_to_cop',
      fixed_side: 'in',
      amount_in: 100,
      amount_out: amountOut,
    });

  const buy = (amountIn: number) =>
    quote({
      provider_id: 'binance_p2p',
      direction: 'cop_to_usd',
      fixed_side: 'out',
      amount_in: amountIn,
      amount_out: 100,
    });

  it('finds the cross when selling pays more than buying costs', () => {
    const found = crossAtBracket([sell(318_000), buy(310_000)], 100);
    assert.deepEqual(found, { selling: 318_000, buying: 310_000 });
  });

  it('says nothing in the ordinary case, which is most of the time', () => {
    // Buying costing more than selling pays is the normal shape of a book.
    // Explaining that would be noise on three quarters of the page loads.
    assert.equal(crossAtBracket([sell(318_000), buy(318_800)], 100), undefined);
  });

  it('equal is not a cross', () => {
    assert.equal(crossAtBracket([sell(318_000), buy(318_000)], 100), undefined);
  });

  it('needs both directions before it claims anything', () => {
    // One side missing is not evidence of a cross; it is evidence of one side.
    assert.equal(crossAtBracket([sell(318_000)], 100), undefined);
    assert.equal(crossAtBracket([buy(310_000)], 100), undefined);
  });

  it('does not mix brackets', () => {
    const other = quote({
      provider_id: 'binance_p2p',
      direction: 'cop_to_usd',
      bracket_usd: 500,
      fixed_side: 'out',
      amount_in: 100,
      amount_out: 100,
    });
    // A cheap buy at 500 must not make 100 look crossed.
    assert.equal(crossAtBracket([sell(318_000), other], 100), undefined);
  });

  it('only looks at the provider that actually crosses', () => {
    // Every provider is compared the same way elsewhere; this note names
    // Binance because Binance is where it was measured. A bitso pair that
    // happened to cross would be a different finding needing its own measuring.
    const bitsoSell = quote({ provider_id: 'bitso', amount_out: 318_000 });
    const bitsoBuy = quote({
      provider_id: 'bitso',
      direction: 'cop_to_usd',
      fixed_side: 'out',
      amount_in: 310_000,
      amount_out: 100,
    });
    assert.equal(crossAtBracket([bitsoSell, bitsoBuy], 100), undefined);
  });
});

describe('the selector', () => {
  // Deliberately holds a local and a remesa row at the SAME direction and
  // bracket. The old fixture could not: its only remesa row sat at a different
  // bracket, so the mode filter it claimed to test was never exercised — the
  // bracket did the excluding and the test passed for the wrong reason.
  const mixed = [
    quote({ provider_id: 'bitso', mode: 'local', direction: 'usd_to_cop', bracket_usd: 100 }),
    quote({ provider_id: 'wise', mode: 'remesa', direction: 'usd_to_cop', bracket_usd: 100 }),
    quote({
      provider_id: 'buda',
      mode: 'local',
      direction: 'cop_to_usd',
      bracket_usd: 100,
      fixed_side: 'out',
    }),
    quote({ provider_id: 'instarem', mode: 'remesa', direction: 'usd_to_cop', bracket_usd: 500 }),
  ];

  it('filters to one direction and bracket, and keeps both modes together', () => {
    const picked = select(mixed, { direction: 'usd_to_cop', bracket: 100 });
    assert.equal(picked.length, 2, 'the local and the remesa row are one list now');
    assert.deepEqual(
      picked.map((q) => q.mode).sort(),
      ['local', 'remesa'],
      'merging the modes is the point: neither is filtered away',
    );
  });

  it('still separates by direction and by bracket', () => {
    assert.equal(select(mixed, { direction: 'cop_to_usd', bracket: 100 }).length, 1);
    assert.equal(select(mixed, { direction: 'usd_to_cop', bracket: 500 }).length, 1);
  });

  it('lists only combinations the data actually has', () => {
    const available = availableSelections(mixed);
    // usd_to_cop@100, cop_to_usd@100, usd_to_cop@500 — the two rows sharing
    // direction and bracket collapse into one selection rather than two.
    assert.equal(available.length, 3);
  });

  it('offers no direction the data cannot answer', () => {
    // Remittances run one way: dollars are sent, pesos are delivered. With only
    // remesa rows there is no "Compro dólares" to offer, and a selector leading
    // to an empty list is worse than one option fewer.
    const onlyRemesa = mixed.filter((q) => q.mode === 'remesa');
    const available = availableSelections(onlyRemesa);
    assert.ok(!available.some((s) => s.direction === 'cop_to_usd'));
  });
});

describe('the tag that replaced the Local/Remesa selector', () => {
  it('names what you end up holding, for every mode', () => {
    assert.equal(modeLabel('remesa'), 'Remesa');
    assert.equal(modeLabel('local'), 'Local');
  });

  it('carries an explanation, because a tag alone is not one', () => {
    // Art. III.2 allows the two to share a list only if each row stays
    // distinguishable. A label nobody understands does not distinguish them.
    assert.match(modeHint('remesa'), /cuenta bancaria/);
    assert.notEqual(modeHint('local'), modeHint('remesa'));
  });
});

describe('every row declares what it is denominated in', () => {
  it('names the asset in words, because USDT means nothing to most readers', () => {
    assert.equal(assetLabel('usdt'), 'USDT');
    assert.equal(assetLabel('usd'), 'dólares');
  });
});

describe('the remittance corridor is one decision, not two', () => {
  /**
   * The page says "desde EE. UU." and the ingest adapter asks Wise for US -> CO.
   * Those are two files that have to agree, and until 2026-09-16 the second one
   * said nothing at all: the corridor was missing from the URL and Wise quoted a
   * fee almost three times higher — 18.203 COP less arriving on 100 USD.
   *
   * The response was internally consistent the whole time, so no check of the
   * data could have found it. What finds it is reading the other file.
   */
  it('shows the same country the adapter asks for', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const adapter = resolve(here, '../../../../packages/ingest/src/adapters/wise.ts');
    const source = readFileSync(adapter, 'utf8');

    const declared = /WISE_SOURCE_COUNTRY\s*=\s*'([A-Z]{2})'/.exec(source)?.[1];
    assert.ok(declared, 'the adapter must export a source country to be pinned to');
    assert.equal(
      declared,
      REMITTANCE_ORIGIN_COUNTRY,
      'the row claims one corridor and the adapter quotes another',
    );
  });

  it('the adapter actually puts it in the URL', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const adapter = resolve(here, '../../../../packages/ingest/src/adapters/wise.ts');
    const source = readFileSync(adapter, 'utf8');

    // The defect was not a wrong country: it was no country. A constant that
    // exists but is never sent would satisfy the test above and change nothing.
    assert.match(source, /sourceCountry=\$\{WISE_SOURCE_COUNTRY\}/);
    assert.match(source, /targetCountry=\$\{WISE_TARGET_COUNTRY\}/);
  });

  it('says where the money comes from, in words', () => {
    assert.match(REMITTANCE_ORIGIN_LABEL, /EE\. UU\./);
    assert.match(modeHint('remesa'), /EE\. UU\./);
  });
});
