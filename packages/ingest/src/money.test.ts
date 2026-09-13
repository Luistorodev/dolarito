/**
 * Golden cases for computeAmounts() (T006b).
 *
 * **These four numbers were computed by hand by the human, not derived from
 * this implementation.** That is the whole point of Article VII.1: a golden
 * case produced by the code it is meant to check proves only that the code
 * agrees with itself. If a case here fails, the suspect is the implementation
 * until proven otherwise — do not edit the expectations to make it pass.
 *
 * Six cases, three per direction. A-D came first; E and F were added after a
 * mutation probe showed that A-D could not pin the canonical order at all.
 * With only one kind of fee present, applying the percentage before the fixed
 * amount gives the same answer as the reverse, so the rule that §3.1 is built
 * around went untested. E and F carry BOTH fees, which is the only shape that
 * separates the two orders.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { computeAmounts } from './money.ts';

describe('computeAmounts — golden cases, hand-computed', () => {
  it('A — usd_to_cop, 100 USD @ 3080, no fees', () => {
    const result = computeAmounts({
      direction: 'usd_to_cop',
      bracket_usd: 100,
      gross_rate: 3080,
    });

    assert.deepEqual(result, {
      in: { amount: 100, currency: 'USD' },
      out: { amount: 308_000, currency: 'COP' },
      fixed_side: 'in',
    });
  });

  it('B — usd_to_cop, 500 USD @ 3080, fixed fee 21.40 USD', () => {
    // 500 - 21.40 = 478.60 USD, then 478.60 x 3080 = 1,474,088 COP exactly.
    const result = computeAmounts({
      direction: 'usd_to_cop',
      bracket_usd: 500,
      gross_rate: 3080,
      fee_fixed_usd: 21.4,
    });

    assert.deepEqual(result, {
      in: { amount: 500, currency: 'USD' },
      out: { amount: 1_474_088, currency: 'COP' },
      fixed_side: 'in',
    });
  });

  it('C — cop_to_usd, 100 USD @ 3088, percentage fee 0.99%', () => {
    // To end up with 100 USD net: 100 / 0.9901 = 100.999899... USD gross,
    // then x 3088 = 311,887.688... COP, which rounds to 311,888.
    // This is the case that pins the rounding policy: it is not exact.
    const result = computeAmounts({
      direction: 'cop_to_usd',
      bracket_usd: 100,
      gross_rate: 3088,
      fee_pct: 0.0099,
    });

    assert.deepEqual(result, {
      in: { amount: 311_888, currency: 'COP' },
      out: { amount: 100, currency: 'USD' },
      fixed_side: 'out',
    });
  });

  it('D — cop_to_usd, 1000 USD @ 3088, fixed fee 5 USD', () => {
    // 1000 + 5 = 1005 USD gross, then x 3088 = 3,103,440 COP exactly.
    const result = computeAmounts({
      direction: 'cop_to_usd',
      bracket_usd: 1000,
      gross_rate: 3088,
      fee_fixed_usd: 5,
    });

    assert.deepEqual(result, {
      in: { amount: 3_103_440, currency: 'COP' },
      out: { amount: 1000, currency: 'USD' },
      fixed_side: 'out',
    });
  });

  it('E — usd_to_cop, 500 USD @ 3080, 0.99% AND a fixed 21.40 USD', () => {
    // Percentage first: 500 x 0.9901 = 495.05 USD.
    // Then the fixed fee:  495.05 - 21.40 = 473.65 USD.
    // Then convert:        473.65 x 3080 = 1,458,842 COP exactly.
    //
    // This is the case that pins the canonical order in the forward direction.
    // Applying the fixed fee first would give 1,459,495 — 653 COP apart, and
    // silent.
    const result = computeAmounts({
      direction: 'usd_to_cop',
      bracket_usd: 500,
      gross_rate: 3080,
      fee_pct: 0.0099,
      fee_fixed_usd: 21.4,
    });

    assert.deepEqual(result, {
      in: { amount: 500, currency: 'USD' },
      out: { amount: 1_458_842, currency: 'COP' },
      fixed_side: 'in',
    });
  });

  it('F — cop_to_usd, 1000 USD @ 3088, 0.99% AND a fixed 5 USD', () => {
    // Undone in reverse: add the fixed fee back, THEN divide out the percentage.
    //   (1000 + 5) / 0.9901 = 1015.048984... USD gross
    //   x 3088              = 3,134,471.265... COP, which rounds to 3,134,471.
    //
    // The mirror of E: it pins the order in the inverse direction. Dividing
    // first and adding after would give 3,134,317 — 154 COP apart.
    const result = computeAmounts({
      direction: 'cop_to_usd',
      bracket_usd: 1000,
      gross_rate: 3088,
      fee_pct: 0.0099,
      fee_fixed_usd: 5,
    });

    assert.deepEqual(result, {
      in: { amount: 3_134_471, currency: 'COP' },
      out: { amount: 1000, currency: 'USD' },
      fixed_side: 'out',
    });
  });
});

/**
 * N3, now pinned by hand-computed numbers rather than by the formula.
 *
 * An earlier version of this block asserted against a value the test itself
 * derived from the formula, which only proved the code agreed with the code.
 * E and F replaced that: their expectations come from the human. What remains
 * here is the negative half — that the implementation does not land on the
 * value the inverted order would produce — which is documentation, since the
 * positive assertion in E and F is what actually holds the line.
 */
describe('computeAmounts — the fee order is not reversible (N3)', () => {
  it('does not produce the inverted-order result in either direction', () => {
    const forward = computeAmounts({
      direction: 'usd_to_cop',
      bracket_usd: 500,
      gross_rate: 3080,
      fee_pct: 0.0099,
      fee_fixed_usd: 21.4,
    });
    assert.equal(forward.out.amount, 1_458_842);
    assert.notEqual(forward.out.amount, 1_459_495);

    const inverse = computeAmounts({
      direction: 'cop_to_usd',
      bracket_usd: 1000,
      gross_rate: 3088,
      fee_pct: 0.0099,
      fee_fixed_usd: 5,
    });
    assert.equal(inverse.in.amount, 3_134_471);
    assert.notEqual(inverse.in.amount, 3_134_317);
  });
});

describe('computeAmounts — the fixed side is never derived', () => {
  it('returns bracket_usd untouched in both directions', () => {
    const forward = computeAmounts({
      direction: 'usd_to_cop',
      bracket_usd: 1,
      gross_rate: 3080.5,
      fee_pct: 0.0123,
    });
    assert.deepEqual(forward.in, { amount: 1, currency: 'USD' });
    assert.equal(forward.fixed_side, 'in');

    const inverse = computeAmounts({
      direction: 'cop_to_usd',
      bracket_usd: 1,
      gross_rate: 3080.5,
      fee_pct: 0.0123,
    });
    assert.deepEqual(inverse.out, { amount: 1, currency: 'USD' });
    assert.equal(inverse.fixed_side, 'out');
  });

  it('rounds COP to the integer, never to cents', () => {
    const result = computeAmounts({
      direction: 'usd_to_cop',
      bracket_usd: 100,
      gross_rate: 3080.337,
    });
    assert.equal(result.out.amount, 308_034); // 308,033.7 rounds up
    assert.equal(Number.isInteger(result.out.amount), true);
  });
});

describe('computeAmounts — refuses nonsense instead of returning it', () => {
  const valid = { direction: 'usd_to_cop', bracket_usd: 100, gross_rate: 3080 } as const;

  it('rejects a non-positive rate', () => {
    assert.throws(() => computeAmounts({ ...valid, gross_rate: 0 }), RangeError);
    assert.throws(() => computeAmounts({ ...valid, gross_rate: -1 }), RangeError);
    assert.throws(() => computeAmounts({ ...valid, gross_rate: Number.NaN }), RangeError);
  });

  it('rejects a percentage outside [0, 1)', () => {
    assert.throws(() => computeAmounts({ ...valid, fee_pct: 1 }), RangeError);
    assert.throws(() => computeAmounts({ ...valid, fee_pct: -0.01 }), RangeError);
  });

  it('rejects fees that eat the whole bracket', () => {
    // 1 USD with a 5 USD fee is below_minimum, not a quote worth computing.
    assert.throws(
      () => computeAmounts({ ...valid, bracket_usd: 1, fee_fixed_usd: 5 }),
      /below_minimum/,
    );
  });
});
