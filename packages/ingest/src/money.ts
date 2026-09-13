/**
 * The single authorized way to derive amounts from a rate and fees
 * (plan.md §3.1). No adapter computes on its own.
 *
 * When a source hands over the final amount — Eldorado, Wise — that amount is
 * the truth for that source and this function is not called; the row is marked
 * `amounts_source: 'provider'`. This is only for sources that give a rate and
 * fees and nothing else.
 */

import type { Money } from './contract.ts';

export type ComputeAmountsInput = {
  direction: 'cop_to_usd' | 'usd_to_cop';
  /** Always the USD side, per plan.md §2.1. */
  bracket_usd: number;
  /** COP per unit of asset. */
  gross_rate: number;
  /** Fraction, e.g. 0.0099. */
  fee_pct?: number;
  fee_fixed_usd?: number;
};

export type ComputeAmountsResult = {
  in: Money;
  out: Money;
  fixed_side: 'in' | 'out';
};

/**
 * Rounding policy.
 *
 * Only the COP side is ever rounded, and only once, at the very end.
 *
 * **The USD side needs no rounding at all**, because it is never derived:
 * `bracket_usd` denominates the fixed side in both directions (plan.md §2.1),
 * so it comes out exactly as it went in. The net or gross USD figure that fees
 * produce is an intermediate — it is what gets converted, and it is never
 * reported as an amount. Keeping it unrounded is what makes case C come out
 * right: rounding 100/0.9901 to cents first would shift the COP result.
 *
 * **COP rounds to the integer**, half away from zero. Colombian pesos have no
 * cents in practice: no provider quotes them, no transfer moves them. Carrying
 * four decimals into the database would be precision we do not have.
 *
 * The half-up tie-break is a convention, not a truth, and it is applied
 * identically in both directions so it cannot favour one provider over another.
 * Its effect is bounded by half a peso on amounts in the hundreds of thousands
 * — far below the spread any ranking turns on.
 */
function toCop(amount: number): number {
  return Math.round(amount);
}

/**
 * Canonical order, identical in both directions: fees apply on the USD side,
 * percentage first and fixed second, and the conversion to COP happens last.
 *
 * `cop_to_usd` runs that same chain backwards, which means undoing it in
 * reverse: the fixed fee is added back before the percentage is divided out.
 * Doing it in the forward order instead would understate what the person pays,
 * because the percentage would be taken off a base that has not yet absorbed
 * the fixed fee.
 */
export function computeAmounts(input: ComputeAmountsInput): ComputeAmountsResult {
  const { direction, bracket_usd, gross_rate } = input;
  const feePct = input.fee_pct ?? 0;
  const feeFixedUsd = input.fee_fixed_usd ?? 0;

  // Fail loudly rather than return a plausible-looking number. A wrong amount
  // here is invisible downstream: it lands in `quotes` as a real observation.
  if (!Number.isFinite(bracket_usd) || bracket_usd <= 0) {
    throw new RangeError(`bracket_usd must be a positive finite number, got ${bracket_usd}`);
  }
  if (!Number.isFinite(gross_rate) || gross_rate <= 0) {
    throw new RangeError(`gross_rate must be a positive finite number, got ${gross_rate}`);
  }
  if (!Number.isFinite(feePct) || feePct < 0 || feePct >= 1) {
    throw new RangeError(`fee_pct must be a fraction in [0, 1), got ${feePct}`);
  }
  if (!Number.isFinite(feeFixedUsd) || feeFixedUsd < 0) {
    throw new RangeError(`fee_fixed_usd must be zero or positive, got ${feeFixedUsd}`);
  }

  if (direction === 'usd_to_cop') {
    const netUsd = bracket_usd * (1 - feePct) - feeFixedUsd;

    // The fees ate the whole bracket. That is not a computation error, it is
    // the provider being unusable at this amount: the adapter should have
    // emitted `out_of_range` with `below_minimum` instead of calling here.
    if (netUsd <= 0) {
      throw new RangeError(
        `fees exceed the bracket: ${bracket_usd} USD leaves ${netUsd} USD after ` +
          `fee_pct ${feePct} and fee_fixed_usd ${feeFixedUsd}. ` +
          `This bracket is below_minimum for this provider, not a quote.`,
      );
    }

    return {
      in: { amount: bracket_usd, currency: 'USD' },
      out: { amount: toCop(netUsd * gross_rate), currency: 'COP' },
      fixed_side: 'in',
    };
  }

  const grossUsd = (bracket_usd + feeFixedUsd) / (1 - feePct);

  return {
    in: { amount: toCop(grossUsd * gross_rate), currency: 'COP' },
    out: { amount: bracket_usd, currency: 'USD' },
    fixed_side: 'out',
  };
}
