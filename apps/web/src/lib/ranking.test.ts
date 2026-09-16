/**
 * Tests for the ranking (T025 partial).
 *
 * The rule under test is Art. III.1, and the way to get it wrong is subtle:
 * sorting by the advertised rate looks right in both directions and is wrong in
 * one of them. Measured on real data, Wise showed the best advertised margin of
 * eleven providers and delivered the worst amount, in the same row.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { LatestQuote } from './quotes.ts';
import {
  assetLabel,
  availableSelections,
  betterIsHigher,
  comparableAmount,
  limitReasonLabel,
  modeHint,
  modeLabel,
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
