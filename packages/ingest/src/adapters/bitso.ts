/**
 * Bitso — USDT/COP (T012).
 *
 * `asset: 'usdt'`, `channel: 'exchange'`, `mode: 'local'`. Eight rows per run:
 * two directions across the four brackets.
 *
 * The rate does not vary with the amount — an exchange ticker is one price for
 * everyone — so every bracket shares it and what varies is the variable side,
 * derived by `computeAmounts()`. Hence `amounts_source: 'computed'`.
 *
 * ---
 *
 * ## Which side of the book, and why it is easy to get backwards
 *
 * `ask` is what the book charges to SELL you USDT; `bid` is what it pays to BUY
 * USDT from you. Mapping them onto our directions:
 *
 * | Direction | The person | Book side | `gross_rate` |
 * |---|---|---|---|
 * | `cop_to_usd` | wants USDT, pays pesos | is buying → hits the **ask** | `ask` |
 * | `usd_to_cop` | hands over USDT, gets pesos | is selling → hits the **bid** | `bid` |
 *
 * Swapping them is silent and flattering: `ask` is always above `bid`, so using
 * `ask` for `usd_to_cop` would report more pesos received than anyone would
 * actually get, and using `bid` for `cop_to_usd` would report a cheaper purchase
 * than exists. On the 2026-09-13 fixture the two sides are 14.20 COP apart —
 * 0.46% — which is small enough to look plausible on every row and large enough
 * to reorder a ranking. The tests pin each direction to its own side by value.
 *
 * ## On `captured_at`
 *
 * Bitso stamps its ticker with `created_at`, and that is NOT what goes into
 * `captured_at`. Per plan.md §2.1 the capture is the event for `quotes`, and the
 * 24-hour cutoff in `latest_quotes` depends on every adapter meaning the same
 * thing by that column. `created_at` is preserved in `raw`, where a future
 * staleness check can reach it — worth remembering for T019, since a source
 * stuck on an old ticker would look fresh by `captured_at` alone.
 */

import type { Quote, QuoteAdapter } from '../contract.ts';
import { type HttpOptions, httpJson } from '../http.ts';
import { computeAmounts } from '../money.ts';

export const BITSO_URL = 'https://api.bitso.com/v3/ticker/?book=usdt_cop';

export const BITSO_BRACKETS = [1, 100, 500, 1000] as const;

const DIRECTIONS = ['usd_to_cop', 'cop_to_usd'] as const;

/**
 * The response as Bitso sends it, with every field optional because none of it
 * is under our control.
 *
 * The `| undefined` on each is deliberate under `exactOptionalPropertyTypes`:
 * for a type modelling external JSON, "absent" and "present and undefined" are
 * both shapes the outside world can hand us, and a test has to be able to build
 * either one. Our own types stay strict — this looseness is the boundary, not
 * the codebase.
 */
export type BitsoResponse = {
  success?: boolean | undefined;
  payload?:
    | {
        book?: string | undefined;
        ask?: string | undefined;
        bid?: string | undefined;
        created_at?: string | undefined;
      }
    | undefined;
};

export type BitsoTicker = {
  ask: number;
  bid: number;
  createdAt: string;
};

function usable(raw: string | undefined, field: string): number {
  if (raw === undefined) {
    throw new Error(`bitso: '${field}' is missing`);
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    // Never zero, never a guess. An unreadable ticker is a failed source, which
    // writes no row at all (Art. I.1, Art. I.2).
    throw new Error(`bitso: '${field}' is not a usable rate: ${raw}`);
  }
  return value;
}

export function parseTicker(body: BitsoResponse): BitsoTicker {
  if (body.success !== true) {
    throw new Error(`bitso: response did not report success: ${JSON.stringify(body.success)}`);
  }

  const payload = body.payload;
  if (payload === undefined) {
    throw new Error('bitso: response has no payload');
  }
  if (payload.book !== undefined && payload.book !== 'usdt_cop') {
    // A different book is a different product. Reading it as USDT/COP would be
    // a quiet category error, not a rounding one.
    throw new Error(`bitso: expected the usdt_cop book, got '${payload.book}'`);
  }

  const ask = usable(payload.ask, 'ask');
  const bid = usable(payload.bid, 'bid');

  if (ask < bid) {
    // A crossed book means we are reading the fields backwards, or the venue is
    // in a state we do not understand. Either way, not a quote.
    throw new Error(`bitso: crossed book, ask ${ask} is below bid ${bid}`);
  }

  if (payload.created_at === undefined) {
    throw new Error('bitso: ticker has no created_at');
  }

  return { ask, bid, createdAt: payload.created_at };
}

/** The book side each direction actually transacts against. */
export function rateFor(ticker: BitsoTicker, direction: (typeof DIRECTIONS)[number]): number {
  return direction === 'cop_to_usd' ? ticker.ask : ticker.bid;
}

export function buildQuotes(ticker: BitsoTicker, body: BitsoResponse, capturedAt: string): Quote[] {
  return DIRECTIONS.flatMap((direction) =>
    BITSO_BRACKETS.map((bracket): Quote => {
      const grossRate = rateFor(ticker, direction);
      const amounts = computeAmounts({
        direction,
        bracket_usd: bracket,
        gross_rate: grossRate,
      });

      return {
        provider_id: 'bitso',
        mode: 'local',
        asset: 'usdt',
        channel: 'exchange',
        direction,
        bracket_usd: bracket,
        fixed_side: amounts.fixed_side,
        status: 'ok',
        in: amounts.in,
        out: amounts.out,
        gross_rate: grossRate,
        // No explicit fee is stated on the ticker, so fee_* stays undefined —
        // never zero (Art. I.1). Bitso's trading fee is not in this response.
        amounts_source: 'computed',
        raw: body,
        captured_at: capturedAt,
      };
    }),
  );
}

export type BitsoOptions = HttpOptions & { now?: () => string };

export function createBitsoAdapter(options: BitsoOptions = {}): QuoteAdapter {
  const { now, ...http } = options;
  const clock = now ?? (() => new Date().toISOString());

  return {
    id: 'bitso',
    kind: 'quote',
    mode: 'local',
    providerIds: ['bitso'],
    fetchQuotes: async (brackets: number[]): Promise<Quote[]> => {
      const body = await httpJson<BitsoResponse>(BITSO_URL, http);
      const ticker = parseTicker(body);
      const capturedAt = clock();

      return buildQuotes(ticker, body, capturedAt).filter((quote) =>
        brackets.includes(quote.bracket_usd),
      );
    },
  };
}
