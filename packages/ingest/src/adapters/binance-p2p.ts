/**
 * Binance P2P — USDT/COP (T016).
 *
 * `asset: 'usdt'`, `channel: 'p2p'`, `mode: 'local'`. Eight rows per run, from
 * two calls: one per direction.
 *
 * ---
 *
 * ## `tradeType` is inverted by design
 *
 * The listings describe the trade from the **advertiser's** side, not ours. Ask
 * for `BUY` and every ad comes back saying `SELL`. Verified 2026-09-13.
 *
 * | We want | We send | Ads say | Direction |
 * |---|---|---|---|
 * | to get USDT for pesos | `tradeType: 'BUY'` | `SELL` | `cop_to_usd` |
 * | to turn USDT into pesos | `tradeType: 'SELL'` | `BUY` | `usd_to_cop` |
 *
 * Reading the field name and trusting it is precisely how the error gets in, so
 * nothing here reads `adv.tradeType` at all — the request decides the meaning.
 * The value assertion in the tests is the real defence (plan.md §3, rule 6).
 *
 * ## There is no single price, so one is computed
 *
 * Each ad quotes its own price and its own capacity. Walking the book
 * best-first and weighting each price by the amount actually taken from it is
 * what a person filling that bracket would really pay.
 *
 * **An ad whose `minSingleTransAmount` exceeds the bracket is skipped.** The
 * plan did not say this and it decides the answer: buying 100 USD, the cheapest
 * ad on 2026-09-13 wanted at least 500,000 COP — about 162 USDT — so it cannot
 * be taken at all. Counting it would produce a weighted price better than
 * anything reachable, in Binance's favour, on every run. Liquidity that will not
 * accept your amount is not liquidity available to you.
 *
 * ## The two out-of-range reasons, and which one actually fires
 *
 * - **`below_minimum`** — no ad accepts an amount this small. This fires every
 *   single run: at the 1 USD bracket, zero of twenty ads qualified in either
 *   direction, the cheapest minimum being about 10.9 USDT.
 * - **`insufficient_liquidity`** — the eligible ads together cannot cover the
 *   bracket. Real, but with 260 and 347 ads live it essentially never happens,
 *   so it is tested against a deliberately truncated fixture rather than left to
 *   be exercised by chance.
 */

import type { Quote, QuoteAdapter } from '../contract.ts';
import { type HttpOptions, httpJson } from '../http.ts';
import { computeAmounts } from '../money.ts';

export const BINANCE_P2P_URL = 'https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search';

/** How many ads are kept in `raw` (plan.md §3.1). */
export const RAW_TOP_N = 10;

const BRACKETS = [1, 100, 500, 1000] as const;
const DIRECTIONS = ['usd_to_cop', 'cop_to_usd'] as const;

type Direction = (typeof DIRECTIONS)[number];

export type BinanceAd = {
  adv?:
    | {
        price?: string | undefined;
        minSingleTransAmount?: string | undefined;
        dynamicMaxSingleTransQuantity?: string | undefined;
      }
    | undefined;
};

export type BinanceResponse = { data?: BinanceAd[] | undefined };

/** One usable ad, already in the units the walk needs. */
export type Offer = {
  /** COP per USDT. */
  price: number;
  /** Smallest trade the ad accepts, in USDT. */
  minUsdt: number;
  /** Largest trade the ad accepts, in USDT. */
  maxUsdt: number;
};

/**
 * The `tradeType` we send. Inverted relative to what the ads will say — see the
 * header. Ours is the user's side of the trade.
 */
export function tradeTypeFor(direction: Direction): 'BUY' | 'SELL' {
  return direction === 'cop_to_usd' ? 'BUY' : 'SELL';
}

export function parseOffers(body: BinanceResponse): Offer[] {
  const ads = body.data;
  if (!Array.isArray(ads)) throw new Error('binance_p2p: response has no ad list');

  const offers: Offer[] = [];

  for (const ad of ads) {
    const price = Number(ad.adv?.price);
    const minCop = Number(ad.adv?.minSingleTransAmount);
    const maxUsdt = Number(ad.adv?.dynamicMaxSingleTransQuantity);

    // A single unreadable ad is not a failed source: the book has hundreds and
    // one malformed entry should not darken the provider. It is skipped.
    if (!Number.isFinite(price) || price <= 0) continue;
    if (!Number.isFinite(minCop) || minCop < 0) continue;
    if (!Number.isFinite(maxUsdt) || maxUsdt <= 0) continue;

    offers.push({ price, minUsdt: minCop / price, maxUsdt });
  }

  if (offers.length === 0) throw new Error('binance_p2p: no readable ads in the response');
  return offers;
}

/** One ad's contribution to a filled bracket. */
export type Taken = { price: number; amount: number };

export type WalkResult =
  | {
      kind: 'ok';
      weightedPrice: number;
      filled: number;
      adsUsed: number;
      eligibleCount: number;
      eligibleCapacity: number;
      /**
       * Exactly what was taken from each ad, in order.
       *
       * This is what makes the weighted price auditable later. `raw` keeps only
       * the top ten ads, and the walk can reach past them: measured on
       * 2026-09-13, the eligible capacity inside the stored ten was 197 USDT
       * against a bracket of 100 — a factor of two. A slightly thinner book and
       * the walk uses ads nobody stored, and the number stops being checkable
       * without anyone noticing. The decomposition does not depend on how many
       * ads were kept.
       */
      taken: Taken[];
    }
  | { kind: 'below_minimum'; eligibleCount: 0; eligibleCapacity: 0 }
  | { kind: 'insufficient_liquidity'; eligibleCount: number; eligibleCapacity: number };

/**
 * Walks the book best-first, taking what each ad will give until the bracket is
 * covered, and weights every price by the amount actually taken from it.
 *
 * The list arrives already ordered best-first for the side requested, so no
 * re-sorting is done: re-sorting would quietly discard Binance's own notion of
 * which offer leads.
 */
export function walkBook(offers: Offer[], bracketUsd: number): WalkResult {
  const eligible = offers.filter((offer) => offer.minUsdt <= bracketUsd);

  if (eligible.length === 0)
    return { kind: 'below_minimum', eligibleCount: 0, eligibleCapacity: 0 };

  const capacity = eligible.reduce((sum, offer) => sum + offer.maxUsdt, 0);
  if (capacity < bracketUsd) {
    // How short it fell is a product question — "by how much?" — and it had no
    // answer while only the verdict was recorded.
    return {
      kind: 'insufficient_liquidity',
      eligibleCount: eligible.length,
      eligibleCapacity: capacity,
    };
  }

  let remaining = bracketUsd;
  let cost = 0;
  const taken: Taken[] = [];

  for (const offer of eligible) {
    if (remaining <= 0) break;
    const amount = Math.min(remaining, offer.maxUsdt);
    cost += amount * offer.price;
    remaining -= amount;
    taken.push({ price: offer.price, amount });
  }

  const filled = bracketUsd - remaining;
  return {
    kind: 'ok',
    weightedPrice: cost / filled,
    filled,
    adsUsed: taken.length,
    eligibleCount: eligible.length,
    eligibleCapacity: capacity,
    taken,
  };
}

export function buildQuote(
  walk: WalkResult,
  raw: unknown,
  direction: Direction,
  bracket: (typeof BRACKETS)[number],
  capturedAt: string,
): Quote {
  const common = {
    provider_id: 'binance_p2p',
    mode: 'local' as const,
    asset: 'usdt' as const,
    channel: 'p2p' as const,
    direction,
    bracket_usd: bracket,
    fixed_side: direction === 'usd_to_cop' ? ('in' as const) : ('out' as const),
    raw,
    captured_at: capturedAt,
  };

  if (walk.kind !== 'ok') {
    // A real observation: we asked, and the book cannot serve this amount.
    // No amounts, because none were quoted (Art. I.1).
    return {
      ...common,
      status: 'out_of_range',
      limit_reason: walk.kind,
      amounts_source: 'computed',
    };
  }

  const amounts = computeAmounts({
    direction,
    bracket_usd: bracket,
    gross_rate: walk.weightedPrice,
  });

  return {
    ...common,
    status: 'ok',
    in: amounts.in,
    out: amounts.out,
    fixed_side: amounts.fixed_side,
    gross_rate: walk.weightedPrice,
    // The advertiser's own fee is not in this response, so fee_* stays
    // undefined — never zero (Art. I.1).
    amounts_source: 'computed',
  };
}

export type BinanceOptions = HttpOptions & { now?: () => string; rows?: number };

export function createBinanceP2pAdapter(options: BinanceOptions = {}): QuoteAdapter {
  const { now, rows, ...http } = options;
  const clock = now ?? (() => new Date().toISOString());
  const pageRows = rows ?? 20;

  return {
    id: 'binance_p2p',
    kind: 'quote',
    mode: 'local',
    providerIds: ['binance_p2p'],
    fetchQuotes: async (brackets: number[]): Promise<Quote[]> => {
      const wanted = BRACKETS.filter((bracket) => brackets.includes(bracket));
      const out: Quote[] = [];

      for (const direction of DIRECTIONS) {
        const body = await httpJson<BinanceResponse>(BINANCE_P2P_URL, {
          ...http,
          method: 'POST',
          json: {
            page: 1,
            rows: pageRows,
            asset: 'USDT',
            fiat: 'COP',
            tradeType: tradeTypeFor(direction),
            payTypes: [],
            publisherType: null,
          },
        });

        const offers = parseOffers(body);
        // Only the top ads are kept: the full page is ~65 KB of publisher
        // profiles per direction, every fifteen minutes (plan.md §3.1).
        const top = (body.data ?? []).slice(0, RAW_TOP_N);
        const capturedAt = clock();

        for (const bracket of wanted) {
          const walk = walkBook(offers, bracket);
          // Per bracket, because the walk is: the ads kept are the same, what
          // the walk did with them is not.
          const raw = { top, kept: RAW_TOP_N, adsSeen: offers.length, walk };
          out.push(buildQuote(walk, raw, direction, bracket, capturedAt));
        }
      }

      return out;
    },
  };
}
