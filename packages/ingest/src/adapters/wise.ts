/**
 * Wise comparison — USD to COP (T017).
 *
 * One call per bracket returns **three providers at once**: Wise, Instarem and
 * Western Union. This is the adapter that makes `providerIds` earn its keep
 * (N2): one failure here darkens three of the eight names, which is why the
 * coverage metric counts providers and not adapters.
 *
 * `mode: 'remesa'`, `asset: 'usd'`, `channel: 'bank_transfer'`, and a single
 * direction — a remittance sends dollars and delivers pesos, so every row is
 * `usd_to_cop` with the input fixed.
 *
 * `amounts_source: 'provider'`: `receivedAmount` is the final figure and is not
 * recomputed. `fee` is absolute USD and maps to `fee_fixed_usd`.
 *
 * ---
 *
 * ## A provider missing from the response produces no row at all
 *
 * At the 1 USD bracket only Instarem comes back; Western Union appears
 * somewhere between 1 and 5, Wise between 20 and 100. Verified 2026-09-13 and
 * consistent across repeated calls.
 *
 * **The response never says why anyone is absent** — there is no status, no
 * reason, no empty entry. So no row is written, and in particular nothing is
 * marked `below_minimum`: that would state a cause the source did not give
 * (Art. I.1). The pattern looks like a minimum, but this endpoint is a periodic
 * comparison harvest rather than a live quote, so an absence can equally mean a
 * corridor they do not cover or a collection pass that did not complete on
 * their side.
 *
 * The consequence is deliberate and recorded in plan.md §3.1: a run yields **up
 * to** twelve rows, not always twelve.
 */

import type { Quote, QuoteAdapter } from '../contract.ts';
import { type HttpOptions, httpJson } from '../http.ts';

export const WISE_URL = 'https://api.wise.com/v4/comparisons/';

const BRACKETS = [1, 100, 500, 1000] as const;

/** Their alias to our catalogue id. Anything else in the response is ignored. */
export const WISE_PROVIDERS: Record<string, string> = {
  wise: 'wise',
  instarem: 'instarem',
  'western-union': 'western_union',
};

export type WiseQuote = {
  fee?: number | undefined;
  rate?: number | undefined;
  receivedAmount?: number | undefined;
  deliveryEstimation?:
    | { duration?: { min?: string | undefined; max?: string | undefined } | undefined | null }
    | undefined;
};

export type WiseResponse = {
  providers?: Array<{ alias?: string | undefined; quotes?: WiseQuote[] | undefined }> | undefined;
};

/**
 * `PT24H` and friends into minutes. Only the shapes this endpoint actually
 * sends are handled; anything else returns undefined rather than a guess.
 */
export function durationToMinutes(iso: string | undefined): number | undefined {
  if (iso === undefined) return undefined;
  const match = /^PT(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?$/.exec(iso);
  if (match === null) return undefined;

  const hours = match[1] === undefined ? 0 : Number(match[1]);
  const minutes = match[2] === undefined ? 0 : Number(match[2]);
  const total = hours * 60 + minutes;

  return total > 0 ? total : undefined;
}

export function buildQuotes(
  body: WiseResponse,
  bracket: (typeof BRACKETS)[number],
  capturedAt: string,
): Quote[] {
  const providers = body.providers;
  if (!Array.isArray(providers)) throw new Error('wise: response has no provider list');

  const rows: Quote[] = [];

  for (const provider of providers) {
    const providerId = provider.alias === undefined ? undefined : WISE_PROVIDERS[provider.alias];
    if (providerId === undefined) continue; // Not one of ours.

    const quote = provider.quotes?.[0];
    if (quote === undefined) continue;

    const received = quote.receivedAmount;
    const rate = quote.rate;
    if (typeof received !== 'number' || !Number.isFinite(received) || received <= 0) continue;
    if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) continue;

    const etaMinutes = durationToMinutes(quote.deliveryEstimation?.duration?.min);

    rows.push({
      provider_id: providerId,
      mode: 'remesa',
      asset: 'usd',
      channel: 'bank_transfer',
      direction: 'usd_to_cop',
      bracket_usd: bracket,
      // A remittance fixes what you send: the bracket is the input.
      fixed_side: 'in',
      status: 'ok',
      in: { amount: bracket, currency: 'USD' },
      out: { amount: received, currency: 'COP' },
      gross_rate: rate,
      // `fee` is absolute USD. It is only recorded when the source states one:
      // a missing fee is unknown, not free (Art. I.1).
      ...(typeof quote.fee === 'number' && Number.isFinite(quote.fee)
        ? { fee_fixed_usd: quote.fee }
        : {}),
      ...(etaMinutes === undefined ? {} : { eta_minutes: etaMinutes }),
      amounts_source: 'provider',
      raw: body,
      captured_at: capturedAt,
    });
  }

  return rows;
}

export type WiseOptions = HttpOptions & { now?: () => string };

export function createWiseAdapter(options: WiseOptions = {}): QuoteAdapter {
  const { now, ...http } = options;
  const clock = now ?? (() => new Date().toISOString());

  return {
    id: 'wise',
    kind: 'quote',
    mode: 'remesa',
    // Three providers from one call. The whole point of N2.
    providerIds: ['wise', 'instarem', 'western_union'],
    fetchQuotes: async (brackets: number[]): Promise<Quote[]> => {
      const wanted = BRACKETS.filter((bracket) => brackets.includes(bracket));
      const rows: Quote[] = [];

      for (const bracket of wanted) {
        const url = `${WISE_URL}?sourceCurrency=USD&targetCurrency=COP&sendAmount=${bracket}`;
        rows.push(...buildQuotes(await httpJson<WiseResponse>(url, http), bracket, clock()));
      }

      return rows;
    },
  };
}
