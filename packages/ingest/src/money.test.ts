/**
 * Golden cases for computeAmounts() (T006b).
 *
 * **These four numbers were computed by hand by the human, not derived from
 * this implementation.** That is the whole point of Article VII.1: a golden
 * case produced by the code it is meant to check proves only that the code
 * agrees with itself. If a case here fails, the suspect is the implementation
 * until proven otherwise — do not edit the expectations to make it pass.
 *
 * Two per direction, as tasks.md requires, and between them they pin every
 * branch of the canonical order: no fees, a fixed fee, a percentage fee, and
 * the inverse direction for each kind of fee.
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
});

describe('computeAmounts — the inverse is not the forward chain (N3)', () => {
  it('undoes the fixed fee before the percentage, not after', () => {
    // Running the forward order backwards would give
    //   (1000 / 0.99) + 5 = 1015.10... USD
    // instead of the correct
    //   (1000 + 5) / 0.99 = 1015.15... USD.
    // The difference is small and entirely silent, which is why it needs a test.
    const result = computeAmounts({
      direction: 'cop_to_usd',
      bracket_usd: 1000,
      gross_rate: 3000,
      fee_pct: 0.01,
      fee_fixed_usd: 5,
    });

    const correctGrossUsd = (1000 + 5) / 0.99;
    const wrongGrossUsd = 1000 / 0.99 + 5;

    assert.equal(result.in.amount, Math.round(correctGrossUsd * 3000));
    assert.notEqual(result.in.amount, Math.round(wrongGrossUsd * 3000));
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
