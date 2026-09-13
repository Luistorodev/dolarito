/**
 * Buda — USDT/COP (T014).
 *
 * `asset: 'usdt'`, `channel: 'exchange'`, `mode: 'local'`. Eight rows per run.
 *
 * **The book is thin and the spread is wide**, and that is why Buda is included
 * with a note rather than left out. On the 2026-09-13 fixture the two sides sit
 * **2.03%** apart, against 0.46% at Bitso on the same pair the same minute —
 * four times wider. The provider row carries the warning so the interface can
 * say it (T014, `providers.notes`).
 *
 * It stays in scope because a wide spread is a real price, not a broken one:
 * hiding it would flatter the market. Art. III.3 — every comparison is at a
 * fixed amount, and this is what that amount actually costs here.
 *
 * ## Field names differ from every other venue
 *
 * Buda reports `min_ask` and `max_bid` — the best available of each side rather
 * than a single quoted price — and each arrives as a **[value, currency]
 * tuple**, `["3102.89", "COP"]`. The currency element is checked rather than
 * skipped: a tuple whose second element stopped being COP would otherwise be
 * read as pesos and be wrong by an exchange rate.
 *
 * | Direction | The person | `gross_rate` |
 * |---|---|---|
 * | `cop_to_usd` | wants USDT, pays pesos → buys | `min_ask` |
 * | `usd_to_cop` | hands over USDT, gets pesos → sells | `max_bid` |
 *
 * ## No timestamp at all
 *
 * The ticker carries no time of its own — unlike Bitso's `created_at`. So
 * `captured_at` is the only temporal anchor this source has, and `raw` holds
 * nothing better. Worth remembering for T019: for Buda there is no
 * source-side clock to cross-check a stale response against.
 */

import type { Quote, QuoteAdapter } from '../contract.ts';
import { type HttpOptions, httpJson } from '../http.ts';
import { computeAmounts } from '../money.ts';

export const BUDA_URL = 'https://www.buda.com/api/v2/markets/usdt-cop/ticker';

const BRACKETS = [1, 100, 500, 1000] as const;
const DIRECTIONS = ['usd_to_cop', 'cop_to_usd'] as const;

/** Buda's `[amount, currency]` pair. */
export type BudaAmount = [string, string];

export type BudaResponse = {
  ticker?:
    | {
        market_id?: string | undefined;
        min_ask?: BudaAmount | undefined;
        max_bid?: BudaAmount | undefined;
      }
    | undefined;
};

export type BudaTicker = { minAsk: number; maxBid: number };

function usable(pair: BudaAmount | undefined, field: string): number {
  if (pair === undefined) throw new Error(`buda: '${field}' is missing`);
  if (!Array.isArray(pair) || pair.length < 2) {
    throw new Error(`buda: '${field}' is not an [amount, currency] pair: ${JSON.stringify(pair)}`);
  }

  const [raw, currency] = pair;
  if (currency !== 'COP') {
    // Reading a non-COP amount as pesos would be wrong by an exchange rate,
    // and nothing downstream would notice.
    throw new Error(`buda: '${field}' is quoted in ${currency}, not COP`);
  }

  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`buda: '${field}' is not a usable rate: ${raw}`);
  }
  return value;
}

export function parseTicker(body: BudaResponse): BudaTicker {
  const ticker = body.ticker;
  if (ticker === undefined) throw new Error('buda: response has no ticker');

  if (ticker.market_id !== undefined && ticker.market_id !== 'USDT-COP') {
    throw new Error(`buda: expected the USDT-COP market, got '${ticker.market_id}'`);
  }

  const minAsk = usable(ticker.min_ask, 'min_ask');
  const maxBid = usable(ticker.max_bid, 'max_bid');

  if (minAsk < maxBid) {
    throw new Error(`buda: crossed book, min_ask ${minAsk} is below max_bid ${maxBid}`);
  }

  return { minAsk, maxBid };
}

export function rateFor(ticker: BudaTicker, direction: (typeof DIRECTIONS)[number]): number {
  return direction === 'cop_to_usd' ? ticker.minAsk : ticker.maxBid;
}

export function buildQuotes(ticker: BudaTicker, body: BudaResponse, capturedAt: string): Quote[] {
  return DIRECTIONS.flatMap((direction) =>
    BRACKETS.map((bracket): Quote => {
      const grossRate = rateFor(ticker, direction);
      const amounts = computeAmounts({ direction, bracket_usd: bracket, gross_rate: grossRate });

      return {
        provider_id: 'buda',
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
        // The ticker states no fee. Undefined, never zero (Art. I.1).
        amounts_source: 'computed',
        raw: body,
        captured_at: capturedAt,
      };
    }),
  );
}

export type BudaOptions = HttpOptions & { now?: () => string };

export function createBudaAdapter(options: BudaOptions = {}): QuoteAdapter {
  const { now, ...http } = options;
  const clock = now ?? (() => new Date().toISOString());

  return {
    id: 'buda',
    kind: 'quote',
    mode: 'local',
    providerIds: ['buda'],
    fetchQuotes: async (brackets: number[]): Promise<Quote[]> => {
      const body = await httpJson<BudaResponse>(BUDA_URL, http);
      const ticker = parseTicker(body);

      return buildQuotes(ticker, body, clock()).filter((quote) =>
        brackets.includes(quote.bracket_usd),
      );
    },
  };
}
