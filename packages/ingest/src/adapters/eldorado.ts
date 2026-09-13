/**
 * El Dorado — USDT/COP over P2P (T015).
 *
 * `asset: 'usdt'`, `channel: 'p2p'`, `mode: 'local'`. **32 rows per run**, not
 * eight: it is the only adapter with a payment-method dimension.
 *
 *   4 methods × 4 brackets × 2 directions = 32
 *
 * ---
 *
 * ## `amounts_source: 'provider'` — nothing here is recomputed
 *
 * Its API already speaks our contract: `fixedSide`, `amountIn`, `amountOut`.
 * When a source hands over the final amount, its arithmetic is the truth for
 * that source (plan.md §3.1), so `computeAmounts()` is deliberately not called.
 *
 * ## The two fee fields, which are different things
 *
 * `fees.total[]` carries **both** `rate` and `value`, and they are not two
 * spellings of one number:
 *
 * | Field | Is | Maps to |
 * |---|---|---|
 * | `rate` | the fraction, e.g. `0.0099` | `fee_pct` |
 * | `value` | the absolute amount in USDT, e.g. `0.9999` | `fee_amount_usd` |
 *
 * Confusing them corrupts amounts silently: at bracket 100 the two are
 * `0.0099` and `0.9999`, close enough in magnitude to look interchangeable and
 * a hundredfold apart in meaning.
 *
 * ## Why there is no `below_minimum` here
 *
 * There is no 5 USD minimum. Verified 2026-09-13: the API quotes 0.5, 1 and 5
 * USD with 200 and rejects nothing. What exists is a **0.49 USDT fee floor**,
 * which at small amounts dominates the price — 1 USD costs 5,215 COP per USDT
 * against 3,129 at bracket 100.
 *
 * So the 1 USD bracket is a real `ok` row at a punitive price, not
 * `out_of_range`. It is not out of range, it is expensive, and marking it
 * otherwise would assert a rejection that never happened while hiding exactly
 * what HU-04 exists to reveal (plan.md §3.2).
 *
 * ## Four methods, and the reasons the list is a constant
 *
 * `/methods` is NOT called per cycle. The four ids below are a product decision
 * recorded in plan.md §3.2, not data to be discovered, and the endpoint returns
 * 289 KB of payment-form schemas we would throw away every fifteen minutes —
 * against the one provider §7.1 is already worried about.
 *
 * ## What is preserved but not represented
 *
 * The quote is not firm: `slippageTolerancePercent: 2`, with `amountIn.maxIn`
 * buying and `amountOut.minOut` selling. We persist `expected` — the quote —
 * and the worst case survives in `raw`. And `expiresAt` sits two minutes after
 * `createdAt`, so a stored row is expired for thirteen of every fifteen
 * minutes. Both are real and neither fits the contract; both are in `raw`.
 */

import type { Quote, QuoteAdapter } from '../contract.ts';
import { type HttpOptions, httpJson } from '../http.ts';

const BASE = 'https://74j6q7lg6a.execute-api.eu-west-1.amazonaws.com/stage/orderbook';

export const ELDORADO_QUOTE_URL = `${BASE}/public/v2/quote`;
export const ELDORADO_METHODS_URL = `${BASE}/methods`;

/** The asset id Eldorado uses for the USDT we quote against. */
export const ELDORADO_ASSET = 'TATUM-TRON-USDT';

/**
 * The four COP payment methods quoted, chosen for real usage in Colombia.
 * Widening this list is a product decision with a measured cost — see
 * plan.md §3.2, and §7.1 for why the cost is not only ours.
 */
export const ELDORADO_METHODS = [
  'bank_bancolombia',
  'app_nequi_co',
  'app_daviplata_co',
  'app_llave_co',
] as const;

const BRACKETS = [1, 100, 500, 1000] as const;
const DIRECTIONS = ['usd_to_cop', 'cop_to_usd'] as const;

type Direction = (typeof DIRECTIONS)[number];

/** External JSON: everything optional, nothing under our control. */
export type EldoradoAmount = {
  amountType?: string | undefined;
  value?: string | undefined;
  expected?: string | undefined;
  maxIn?: string | undefined;
  minOut?: string | undefined;
  slippageTolerancePercent?: string | undefined;
  asset?: string | undefined;
  paymentMethodId?: string | undefined;
};

export type EldoradoQuoteResponse = {
  data?:
    | {
        quote?:
          | {
              fixedSide?: string | undefined;
              displayRate?: string | undefined;
              expiresAt?: string | undefined;
              createdAt?: string | undefined;
              amountIn?: EldoradoAmount | undefined;
              amountOut?: EldoradoAmount | undefined;
              fees?:
                | {
                    total?:
                      | Array<{ rate?: string | undefined; value?: string | undefined }>
                      | undefined;
                  }
                | undefined;
            }
          | undefined;
      }
    | undefined;
};

/** What one quote yields, before it becomes a row. */
export type EldoradoQuote = {
  amountInCop: number;
  amountOutCop: number;
  usdAmount: number;
  grossRate: number;
  feePct: number;
  feeAmountUsd: number;
};

function usable(raw: string | undefined, field: string): number {
  if (raw === undefined) throw new Error(`eldorado: '${field}' is missing`);
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`eldorado: '${field}' is not usable: ${raw}`);
  }
  return value;
}

/** The request body for one direction, bracket and method. */
export function quoteBody(direction: Direction, bracket: number, paymentMethodId: string): unknown {
  const fiat = { assetType: 'FIAT', asset: 'COP', paymentMethodId };
  const crypto = { assetType: 'EL_DORADO', asset: ELDORADO_ASSET };

  // The bracket always denominates the USD side, so it is the fixed one —
  // which is exactly what fixedSide means here too (plan.md §2.1).
  return direction === 'cop_to_usd'
    ? { amount: String(bracket), fixedSide: 'OUT', in: fiat, out: crypto, preview: true }
    : { amount: String(bracket), fixedSide: 'IN', in: crypto, out: fiat, preview: true };
}

export function parseQuote(
  body: EldoradoQuoteResponse,
  direction: Direction,
  bracket: number,
): EldoradoQuote {
  const quote = body.data?.quote;
  if (quote === undefined) throw new Error('eldorado: response has no quote');

  const expectedSide = direction === 'cop_to_usd' ? 'OUT' : 'IN';
  if (quote.fixedSide !== expectedSide) {
    // If the venue fixed a different side than we asked for, the numbers below
    // mean something other than what we are about to record.
    throw new Error(
      `eldorado: asked to fix ${expectedSide} for ${direction}, got '${quote.fixedSide}'`,
    );
  }

  const fee = quote.fees?.total?.[0];
  if (fee === undefined) throw new Error('eldorado: quote states no fees.total');

  // rate is the fraction, value the absolute USDT amount. Both are read, and
  // each goes to its own column.
  const feePct = Number(fee.rate);
  const feeAmountUsd = Number(fee.value);
  if (!Number.isFinite(feePct) || feePct < 0) {
    throw new Error(`eldorado: fee rate is not a usable fraction: ${fee.rate}`);
  }
  if (!Number.isFinite(feeAmountUsd) || feeAmountUsd < 0) {
    throw new Error(`eldorado: fee value is not a usable amount: ${fee.value}`);
  }

  const copSide = direction === 'cop_to_usd' ? quote.amountIn : quote.amountOut;
  const usdSide = direction === 'cop_to_usd' ? quote.amountOut : quote.amountIn;

  // The variable side reports `expected`; the fixed side reports `value`.
  const copAmount = usable(copSide?.expected, `${direction} variable COP side`);
  const usdAmount = usable(usdSide?.value, `${direction} fixed USD side`);

  if (usdAmount !== bracket) {
    throw new Error(`eldorado: asked for ${bracket} USD, the quote fixed ${usdAmount}`);
  }

  return {
    amountInCop: direction === 'cop_to_usd' ? copAmount : 0,
    amountOutCop: direction === 'cop_to_usd' ? 0 : copAmount,
    usdAmount,
    grossRate: copAmount / usdAmount,
    feePct,
    feeAmountUsd,
  };
}

export function toRow(
  parsed: EldoradoQuote,
  body: EldoradoQuoteResponse,
  direction: Direction,
  bracket: (typeof BRACKETS)[number],
  paymentMethod: string,
  capturedAt: string,
): Quote {
  const usd = { amount: parsed.usdAmount, currency: 'USD' as const };
  const cop = {
    amount: direction === 'cop_to_usd' ? parsed.amountInCop : parsed.amountOutCop,
    currency: 'COP' as const,
  };

  return {
    provider_id: 'eldorado',
    mode: 'local',
    asset: 'usdt',
    channel: 'p2p',
    direction,
    bracket_usd: bracket,
    payment_method: paymentMethod,
    fixed_side: direction === 'cop_to_usd' ? 'out' : 'in',
    status: 'ok',
    in: direction === 'cop_to_usd' ? cop : usd,
    out: direction === 'cop_to_usd' ? usd : cop,
    gross_rate: parsed.grossRate,
    fee_pct: parsed.feePct,
    fee_amount_usd: parsed.feeAmountUsd,
    // amounts_source: 'provider' — the amounts above are Eldorado's own, not
    // recomputed. fee_fixed_usd stays undefined: the floor shows up inside
    // `value`, and the source never states it as a separate fixed fee.
    amounts_source: 'provider',
    raw: body,
    captured_at: capturedAt,
  };
}

export type EldoradoOptions = HttpOptions & {
  now?: () => string;
  methods?: readonly string[];
};

export function createEldoradoAdapter(options: EldoradoOptions = {}): QuoteAdapter {
  const { now, methods, ...http } = options;
  const clock = now ?? (() => new Date().toISOString());
  const paymentMethods = methods ?? ELDORADO_METHODS;

  return {
    id: 'eldorado',
    kind: 'quote',
    mode: 'local',
    providerIds: ['eldorado'],
    fetchQuotes: async (brackets: number[]): Promise<Quote[]> => {
      const wanted = BRACKETS.filter((bracket) => brackets.includes(bracket));
      const rows: Quote[] = [];

      // In series on purpose. Every one of these creates a record on their
      // side (plan.md §7.1); firing 32 at once would look worse than it is.
      for (const direction of DIRECTIONS) {
        for (const bracket of wanted) {
          for (const paymentMethod of paymentMethods) {
            const body = await httpJson<EldoradoQuoteResponse>(ELDORADO_QUOTE_URL, {
              ...http,
              method: 'POST',
              json: quoteBody(direction, bracket, paymentMethod),
            });

            const parsed = parseQuote(body, direction, bracket);
            rows.push(toRow(parsed, body, direction, bracket, paymentMethod, clock()));
          }
        }
      }

      return rows;
    },
  };
}
