/**
 * The ranking (T025, partial — HU-01, HU-04, Art. III.1).
 *
 * ## What decides the order, and what must never
 *
 * Article III.1: never rank by the advertised rate. The comparison is at a
 * fixed amount, so the question is always "how much of the variable side", and
 * which side is variable depends on the direction:
 *
 * | `fixed_side` | The person… | Better is | Order |
 * |---|---|---|---|
 * | `in` | hands over a fixed USD amount, receives pesos | more pesos | `amount_out` DESC |
 * | `out` | wants a fixed USD amount, pays pesos | fewer pesos | `amount_in` ASC |
 *
 * `gross_rate` is not consulted. It cannot be: for the three providers with a
 * fixed fee it says the opposite of the truth — measured, Wise showed the best
 * advertised margin of eleven and delivered the worst amount.
 *
 * ## Eldorado is deliberately NOT ranked yet
 *
 * It is the only provider with a payment-method dimension: four rows per
 * bracket and direction where everyone else has one. Ranking its best method
 * compares "the best of four" against "the only one" others have, which
 * Art. III.3 forbids.
 *
 * So `eldorado` is a **required** parameter with no default, and `undefined`
 * means the decision is still open. Under `undefined` its rows are set aside
 * into `deferred` rather than silently included — because including them *is*
 * the `all-methods` policy, chosen by accident. That is the failure working
 * rule 4 exists to prevent: a decision nobody took becomes permanent because
 * nothing looked broken.
 *
 * Measured 2026-09-14: the four methods do **not** collapse — 14 of 24 cells
 * differ, up to 10.5% apart buying at the 1 USD bracket. So this matters.
 */

import type { EldoradoPolicy } from './pending.ts';
import type { LatestQuote } from './quotes.ts';

/** The one provider whose representation is still open. */
export const UNDECIDED_PROVIDER = 'eldorado';

export type RankedRow = {
  quote: LatestQuote;
  /** 1-based, and only for rows that have an amount to compare. */
  position: number;
  /**
   * How much worse than the leader, in pesos. Zero for the leader itself.
   * Money rather than a percentage: RF asks for the difference expressed in
   * money, and "18.000 pesos" is actionable in a way that "0,6 %" is not.
   */
  behindBy: number;
};

export type Ranking = {
  rows: RankedRow[];
  /** Visible, with their reason. They have no amount, so they are not ranked. */
  outOfRange: LatestQuote[];
  /** Eldorado's rows while its representation is undecided. */
  deferred: LatestQuote[];
};

/** The number the order is built on, or undefined when there is none. */
export function comparableAmount(quote: LatestQuote): number | undefined {
  if (quote.status !== 'ok') return undefined;
  const value = quote.fixed_side === 'in' ? quote.amount_out : quote.amount_in;
  return value === null ? undefined : value;
}

/** Lower is better when paying pesos, higher is better when receiving them. */
export function betterIsHigher(fixedSide: LatestQuote['fixed_side']): boolean {
  return fixedSide === 'in';
}

export function rank(
  quotes: readonly LatestQuote[],
  eldorado: EldoradoPolicy | undefined,
): Ranking {
  const deferred: LatestQuote[] = [];
  const outOfRange: LatestQuote[] = [];
  const rankable: Array<{ quote: LatestQuote; amount: number }> = [];

  for (const quote of quotes) {
    if (eldorado === undefined && quote.provider_id === UNDECIDED_PROVIDER) {
      deferred.push(quote);
      continue;
    }

    const amount = comparableAmount(quote);
    if (amount === undefined) {
      // Kept and shown, per HU-04: "no alcanza el mínimo" is an answer, and
      // dropping the row would make the provider look absent instead of
      // unavailable at that amount.
      outOfRange.push(quote);
      continue;
    }

    rankable.push({ quote, amount });
  }

  const first = rankable[0]?.quote;
  const higherIsBetter = first === undefined ? true : betterIsHigher(first.fixed_side);

  rankable.sort((a, b) => (higherIsBetter ? b.amount - a.amount : a.amount - b.amount));

  const leader = rankable[0]?.amount;
  const rows = rankable.map((entry, index) => ({
    quote: entry.quote,
    position: index + 1,
    behindBy: leader === undefined ? 0 : Math.abs(entry.amount - leader),
  }));

  return { rows, outOfRange, deferred };
}

export type Selection = {
  mode: LatestQuote['mode'];
  direction: LatestQuote['direction'];
  bracket: number;
};

export function select(quotes: readonly LatestQuote[], selection: Selection): LatestQuote[] {
  return quotes.filter(
    (quote) =>
      quote.mode === selection.mode &&
      quote.direction === selection.direction &&
      quote.bracket_usd === selection.bracket,
  );
}

/** Every combination present in the data, so the page renders no empty selector. */
export function availableSelections(quotes: readonly LatestQuote[]): Selection[] {
  const seen = new Map<string, Selection>();
  for (const quote of quotes) {
    const key = `${quote.mode}|${quote.direction}|${quote.bracket_usd}`;
    if (!seen.has(key)) {
      seen.set(key, {
        mode: quote.mode,
        direction: quote.direction,
        bracket: quote.bracket_usd,
      });
    }
  }
  return [...seen.values()];
}

/** What the person hands over and receives, said in words rather than in a code. */
export function directionLabel(direction: LatestQuote['direction']): string {
  return direction === 'usd_to_cop' ? 'Vendo dólares' : 'Compro dólares';
}

/**
 * What the row is actually denominated in.
 *
 * T025 requires every row to declare its `asset`: the Local mode is stablecoin,
 * and somebody comparing a bank transfer against USDT should be able to see
 * that without knowing what USDT is.
 */
export function assetLabel(asset: LatestQuote['asset']): string {
  return { usd: 'dólares', usdt: 'USDT', usdc: 'USDC' }[asset];
}

export function channelLabel(channel: LatestQuote['channel']): string {
  return {
    exchange: 'exchange',
    p2p: 'P2P',
    bank_transfer: 'transferencia bancaria',
    fintech: 'fintech',
  }[channel];
}

export function limitReasonLabel(reason: LatestQuote['limit_reason']): string {
  if (reason === 'below_minimum') return 'no acepta montos tan chicos';
  if (reason === 'above_maximum') return 'supera su máximo';
  if (reason === 'insufficient_liquidity') return 'no hay suficiente oferta';
  return 'no disponible';
}
