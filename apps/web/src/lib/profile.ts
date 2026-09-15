/**
 * What we can say about a provider (T027, RF-15).
 *
 * ## Everything here is derived from captured rows
 *
 * The catalogue in `packages/ingest/src/lib/providers.ts` carries a `notes`
 * field written from general knowledge and never reviewed. One of those notes
 * was found on 2026-09-15 to assert a 5 USD minimum for El Dorado **citing the
 * task that disproved it** — a claim that looked sourced and was wrong.
 *
 * So none of that prose reaches a page. What a profile says is computed from
 * rows we captured: which asset, which channel, which payment methods actually
 * quoted, which brackets answered and which refused, and whether the price
 * moves with the amount. Each of those is a fact about a measurement, and if it
 * is wrong the data is wrong — which is a different and much louder problem
 * than prose being wrong.
 */

import type { LatestQuote } from './quotes.ts';
import { assetLabel, channelLabel } from './ranking.ts';

export type BracketOutcome = {
  bracket: number;
  direction: LatestQuote['direction'];
  status: LatestQuote['status'];
  limitReason: LatestQuote['limit_reason'];
};

export type Profile = {
  id: string;
  mode: LatestQuote['mode'];
  asset: LatestQuote['asset'];
  channel: LatestQuote['channel'];
  /** Empty for the seven providers with no payment-method dimension. */
  paymentMethods: string[];
  brackets: BracketOutcome[];
  /**
   * Whether the advertised rate changes with the amount.
   *
   * `undefined` when there is only one bracket to look at — no observation,
   * rather than a guess dressed as one.
   */
  priceVariesByAmount: boolean | undefined;
  /** Whether the provider ever states a fee of its own. */
  statesAFee: boolean;
  newestCapture: string | undefined;
  rowCount: number;
};

export function buildProfile(id: string, quotes: readonly LatestQuote[]): Profile | undefined {
  const mine = quotes.filter((quote) => quote.provider_id === id);
  const first = mine[0];
  if (first === undefined) return undefined;

  const paymentMethods = [
    ...new Set(mine.map((q) => q.payment_method).filter((m): m is string => m !== null)),
  ].sort();

  const brackets: BracketOutcome[] = [
    ...new Map(
      mine.map((q) => [
        `${q.direction}|${q.bracket_usd}`,
        {
          bracket: q.bracket_usd,
          direction: q.direction,
          status: q.status,
          limitReason: q.limit_reason,
        },
      ]),
    ).values(),
  ].sort((a, b) => a.direction.localeCompare(b.direction) || a.bracket - b.bracket);

  // Compared within one direction and one payment method, so a difference is
  // about the amount and not about which of Eldorado's methods was cheapest.
  const sameLane = mine.filter(
    (q) => q.direction === first.direction && q.payment_method === first.payment_method,
  );
  const rates = [...new Set(sameLane.map((q) => q.gross_rate).filter((r) => r !== null))];
  const priceVariesByAmount = sameLane.length < 2 ? undefined : rates.length > 1;

  return {
    id,
    mode: first.mode,
    asset: first.asset,
    channel: first.channel,
    paymentMethods,
    brackets,
    priceVariesByAmount,
    statesAFee: mine.some(
      (q) => q.fee_pct !== null || q.fee_fixed_usd !== null || q.fee_amount_usd !== null,
    ),
    newestCapture: mine.reduce<string | undefined>(
      (newest, q) => (newest === undefined || q.captured_at > newest ? q.captured_at : newest),
      undefined,
    ),
    rowCount: mine.length,
  };
}

/**
 * The one-line characterisation, assembled from the profile.
 *
 * Written from fields rather than stored as prose: a sentence built out of
 * `asset` and `channel` cannot go stale against the data the way a hand-written
 * one can, because it *is* the data.
 */
export function summarise(profile: Profile): string {
  const where = profile.mode === 'local' ? 'Local' : 'Remesa';
  return `${where} · ${channelLabel(profile.channel)} · cotiza en ${assetLabel(profile.asset)}`;
}

/** Observations, each traceable to a measurement rather than to a belief. */
export function observations(profile: Profile): string[] {
  const said: string[] = [];

  if (profile.priceVariesByAmount === false) {
    said.push('El precio no cambia con el monto: es el mismo para cualquier cantidad.');
  }
  if (profile.priceVariesByAmount === true) {
    said.push('El precio cambia según el monto, así que conviene mirar el tuyo.');
  }

  if (profile.paymentMethods.length > 1) {
    said.push(
      `Cotiza ${profile.paymentMethods.length} métodos de pago distintos, y el precio ` +
        'no es el mismo en todos.',
    );
  }

  said.push(
    profile.statesAFee
      ? 'Declara una comisión aparte del precio, y está incluida en lo que ves.'
      : 'No declara comisión aparte. Si cobra algo, va dentro del precio.',
  );

  const refused = profile.brackets.filter((b) => b.status === 'out_of_range');
  if (refused.length > 0) {
    const amounts = [...new Set(refused.map((b) => b.bracket))].sort((a, b) => a - b);
    said.push(`No opera en ${amounts.map((a) => `${a} USD`).join(', ')}.`);
  }

  return said;
}
