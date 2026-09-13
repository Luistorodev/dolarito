/**
 * DolarApp — USDC/COP (T013).
 *
 * `asset: 'usdc'`, `channel: 'fintech'`, `mode: 'local'`. Eight rows per run.
 *
 * **No fee is stated anywhere in the response**, because DolarApp carries it
 * inside the price (plan.md §3.1). So every `fee_*` stays `undefined` — never
 * zero. "The source did not tell us" and "there is no fee" are different facts,
 * and writing 0 would assert the second while only knowing the first
 * (Art. I.1). The spread is where the cost lives, and `gross_rate` already
 * carries it.
 *
 * ## Which side each direction uses
 *
 * | Direction | The person | `gross_rate` |
 * |---|---|---|
 * | `cop_to_usd` | wants USDC, pays pesos → buys | `ask` |
 * | `usd_to_cop` | hands over USDC, gets pesos → sells | `bid` |
 *
 * Pinned by value in the tests, per the spread rule in plan.md §3: on the
 * 2026-09-13 fixture the two sides are 0.87% apart, so an inversion would make
 * DolarApp look better than it is on all eight rows without breaking anything a
 * structural test would notice.
 *
 * ## On the timestamp
 *
 * `date` comes with nanoseconds and **no timezone marker** —
 * `2026-09-13T20:54:56.703424986` — so it is a floating timestamp, not an
 * instant. It is preserved verbatim in `raw` and deliberately not parsed:
 * guessing a zone would invent precision the source never gave. `captured_at`
 * is our own clock, consistent with every other adapter.
 */

import type { Quote, QuoteAdapter } from '../contract.ts';
import { type HttpOptions, httpJson } from '../http.ts';
import { computeAmounts } from '../money.ts';

export const DOLARAPP_URL = 'https://api.dolarapp.com/v1/tickers?currencies=COP';

const BRACKETS = [1, 100, 500, 1000] as const;
const DIRECTIONS = ['usd_to_cop', 'cop_to_usd'] as const;

/** External JSON: every field optional, absent and explicit-undefined both possible. */
export type DolarAppTickerRow = {
  ask?: string | undefined;
  bid?: string | undefined;
  book?: string | undefined;
  date?: string | undefined;
};

export type DolarAppResponse = DolarAppTickerRow[];

export type DolarAppTicker = { ask: number; bid: number };

function usable(raw: string | undefined, field: string): number {
  if (raw === undefined) throw new Error(`dolarapp: '${field}' is missing`);
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`dolarapp: '${field}' is not a usable rate: ${raw}`);
  }
  return value;
}

export function parseTicker(body: DolarAppResponse): DolarAppTicker {
  if (!Array.isArray(body) || body.length === 0) {
    throw new Error('dolarapp: the endpoint returned no ticker');
  }

  const row = body[0];
  if (row === undefined) throw new Error('dolarapp: the endpoint returned no ticker');

  if (row.book !== undefined && row.book !== 'usdc_cop') {
    // A different book is a different product, not a rounding error.
    throw new Error(`dolarapp: expected the usdc_cop book, got '${row.book}'`);
  }

  const ask = usable(row.ask, 'ask');
  const bid = usable(row.bid, 'bid');

  if (ask < bid) {
    throw new Error(`dolarapp: crossed book, ask ${ask} is below bid ${bid}`);
  }

  return { ask, bid };
}

export function rateFor(ticker: DolarAppTicker, direction: (typeof DIRECTIONS)[number]): number {
  return direction === 'cop_to_usd' ? ticker.ask : ticker.bid;
}

export function buildQuotes(
  ticker: DolarAppTicker,
  body: DolarAppResponse,
  capturedAt: string,
): Quote[] {
  return DIRECTIONS.flatMap((direction) =>
    BRACKETS.map((bracket): Quote => {
      const grossRate = rateFor(ticker, direction);
      const amounts = computeAmounts({ direction, bracket_usd: bracket, gross_rate: grossRate });

      return {
        provider_id: 'dolarapp',
        mode: 'local',
        asset: 'usdc',
        channel: 'fintech',
        direction,
        bracket_usd: bracket,
        fixed_side: amounts.fixed_side,
        status: 'ok',
        in: amounts.in,
        out: amounts.out,
        gross_rate: grossRate,
        // fee_* omitted on purpose: the source states none. See the header.
        amounts_source: 'computed',
        raw: body,
        captured_at: capturedAt,
      };
    }),
  );
}

export type DolarAppOptions = HttpOptions & { now?: () => string };

export function createDolarAppAdapter(options: DolarAppOptions = {}): QuoteAdapter {
  const { now, ...http } = options;
  const clock = now ?? (() => new Date().toISOString());

  return {
    id: 'dolarapp',
    kind: 'quote',
    mode: 'local',
    providerIds: ['dolarapp'],
    fetchQuotes: async (brackets: number[]): Promise<Quote[]> => {
      const body = await httpJson<DolarAppResponse>(DOLARAPP_URL, http);
      const ticker = parseTicker(body);

      return buildQuotes(ticker, body, clock()).filter((quote) =>
        brackets.includes(quote.bracket_usd),
      );
    },
  };
}
