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

/**
 * Applies the Eldorado policy, decided 2026-09-21 with the measured week.
 *
 * The measurement that decided it: across 6.512 cells the four methods **priced
 * differently in 3.710**, with spreads up to 4,38 % buying at 1 USD and 1,52 %
 * selling at 1000. They do not collapse, so averaging them would blend numbers
 * that are genuinely four percent apart, and `all-methods` would hand Eldorado
 * four of every eleven rows for being the only provider with a method
 * dimension. The chosen policy is `best-method`, with the method named on the
 * row so the number is attributable.
 *
 * It costs something and the cost is worth stating: the spread between methods
 * stops being visible in the ranking. It lives on the provider page, which is
 * where a 4 % difference between four ways of paying actually belongs.
 *
 * The three policies produced **identical** leader statistics over the week,
 * because Eldorado never led a single cell. So this choice does not move the
 * ranking and was taken on legibility, which is the honest reason.
 */
function applyEldoradoPolicy(rows: readonly LatestQuote[], policy: EldoradoPolicy): LatestQuote[] {
  const mine = rows.filter((q) => q.provider_id === UNDECIDED_PROVIDER);
  const others = rows.filter((q) => q.provider_id !== UNDECIDED_PROVIDER);
  if (mine.length === 0) return [...others];

  if (policy === 'all-methods') return [...rows];

  if (policy === 'fixed-method') {
    // Reachable only if somebody selects it, and nobody has: which method it
    // would be is a decision that was never taken. Rule 4 says mark what is
    // undecided rather than fill it with a provisional value, so this refuses
    // instead of quietly picking one.
    throw new Error(
      "EldoradoPolicy 'fixed-method' needs the method chosen first; " +
        'no method was ever selected, and picking one here would be a ' +
        'provisional value pretending to be a decision.',
    );
  }

  // 'best-method': one row, the best-priced, judged the same way the ranking
  // judges everything else — never by the advertised rate (Art. III.1).
  let best: LatestQuote | undefined;
  let bestAmount: number | undefined;
  for (const quote of mine) {
    const amount = comparableAmount(quote);
    if (amount === undefined) continue;
    if (bestAmount === undefined || best === undefined) {
      best = quote;
      bestAmount = amount;
      continue;
    }
    const higherWins = betterIsHigher(quote.fixed_side);
    if (higherWins ? amount > bestAmount : amount < bestAmount) {
      best = quote;
      bestAmount = amount;
    }
  }

  // Every method out of range at this bracket: keep them so the provider reads
  // as unavailable here rather than absent (HU-04), same as any other row.
  if (best === undefined) return [...others, ...mine];
  return [...others, best];
}

/** The provider whose book crosses, and the only one measured doing it. */
export const CROSSING_PROVIDER = 'binance_p2p';

export type Cross = {
  /** Pesos received for the bracket when selling. */
  readonly selling: number;
  /** Pesos paid for the same bracket when buying. */
  readonly buying: number;
};

/**
 * Whether the Binance P2P book crosses at a bracket: selling the dollars yields
 * more pesos than buying them costs.
 *
 * Measured over the closing week: **572 of 2.386 comparable cells, 24 %**, and
 * spread evenly — 23 % at 100, 23 % at 500, 26 % at 1000. The three-run reading
 * from 2026-09-14 had suggested it was concentrated in the large brackets; a
 * week says it is not, which is the kind of correction the window existed for.
 *
 * At 24 % it is not a curiosity, so RF-11c stops being hypothetical and the
 * interface explains it (decision #3, `explain`, taken 2026-09-21).
 *
 * It is a real property of a peer-to-peer book, not an error of ours: buyers
 * and sellers post their own ads, and nothing forces one side to be cheaper.
 * Saying so is the point — a reader who spots it unexplained will assume the
 * comparator is broken.
 */
export function crossAtBracket(quotes: readonly LatestQuote[], bracket: number): Cross | undefined {
  const rows = quotes.filter(
    (q) => q.provider_id === CROSSING_PROVIDER && q.bracket_usd === bracket,
  );

  const sell = rows.find((q) => q.direction === 'usd_to_cop');
  const buy = rows.find((q) => q.direction === 'cop_to_usd');
  if (sell === undefined || buy === undefined) return undefined;

  const selling = comparableAmount(sell);
  const buying = comparableAmount(buy);
  if (selling === undefined || buying === undefined) return undefined;

  // Crossed only when selling pays more than buying costs. Equal is not a
  // cross, and the ordinary case — buying costs more — is not either.
  return selling > buying ? { selling, buying } : undefined;
}

export function rank(
  quotes: readonly LatestQuote[],
  eldorado: EldoradoPolicy | undefined,
): Ranking {
  const deferred: LatestQuote[] = [];
  const outOfRange: LatestQuote[] = [];
  const rankable: Array<{ quote: LatestQuote; amount: number }> = [];

  const considered = eldorado === undefined ? quotes : applyEldoradoPolicy(quotes, eldorado);

  for (const quote of considered) {
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

/**
 * What a ranking is scoped to.
 *
 * **`mode` is deliberately not part of it, since 2026-09-16.** Local and Remesa
 * used to be two separate rankings behind a selector, and the cost was that
 * three of the eight providers were invisible unless you knew to look for them
 * — the selector said "Local | Remesa" and nothing said Wise was behind the
 * second one.
 *
 * Art. III.2 permits the merge and sets its price: *"Pueden verse juntos, pero
 * cada fila declara su `asset` y su `channel` de forma visible."* So every row
 * carries its asset, its channel and now its mode as well. **Removing the
 * selector must not remove the distinction it carried** — it moves into the
 * row, it does not disappear.
 *
 * Art. III.3 is unaffected: the comparison is still at a declared fixed amount.
 * What changed is which offers are in the same list, not what is being compared.
 */
export type Selection = {
  direction: LatestQuote['direction'];
  bracket: number;
};

export function select(quotes: readonly LatestQuote[], selection: Selection): LatestQuote[] {
  return quotes.filter(
    (quote) => quote.direction === selection.direction && quote.bracket_usd === selection.bracket,
  );
}

/** Every combination present in the data, so the page renders no empty selector. */
export function availableSelections(quotes: readonly LatestQuote[]): Selection[] {
  const seen = new Map<string, Selection>();
  for (const quote of quotes) {
    const key = `${quote.direction}|${quote.bracket_usd}`;
    if (!seen.has(key)) {
      seen.set(key, {
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
 * The tag that replaced the Local/Remesa selector.
 *
 * It says what you end up holding, not what the category is called internally,
 * because "Local" and "Remesa" only mean something to us. A remittance puts
 * pesos in a Colombian bank account; the local providers hand you a stablecoin
 * balance or a fintech balance. Those are different products that happen to be
 * comparable at a fixed amount, and the tag is what keeps them distinguishable
 * now that they share one list (Art. III.2).
 */
export function modeLabel(mode: LatestQuote['mode']): string {
  return mode === 'remesa' ? 'Remesa' : 'Local';
}

/**
 * Where a remittance is sent from, shown on the row.
 *
 * It is an assumption, and it is declared rather than hidden in a URL. The
 * ingest adapter asks Wise for the US -> CO corridor, and the fee depends on
 * it: leaving the corridor out understated Wise by 18.203 COP on a 100 USD
 * transfer until 2026-09-16. Instarem and Western Union quote that corridor
 * already, which is what makes the three comparable at all (Art. III.3).
 *
 * The country below is pinned to `WISE_SOURCE_COUNTRY` in
 * `packages/ingest/src/adapters/wise.ts` by a test that reads that file. Change
 * one without the other and the build fails, which is the point: a label saying
 * "from the US" over data quoted for somewhere else is worse than no label.
 */
export const REMITTANCE_ORIGIN_COUNTRY = 'US';
export const REMITTANCE_ORIGIN_LABEL = 'desde EE. UU.';

/** The longer form, for the tag's tooltip: the tag alone is not an explanation. */
export function modeHint(mode: LatestQuote['mode']): string {
  return mode === 'remesa'
    ? `Giro internacional ${REMITTANCE_ORIGIN_LABEL}: los pesos llegan a una cuenta bancaria en Colombia. La comisión depende del país de origen.`
    : 'Comprás o vendés dentro de Colombia y quedás con el saldo en la plataforma.';
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
