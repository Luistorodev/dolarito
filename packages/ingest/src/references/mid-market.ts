/**
 * Mid-market rate — USD/COP (T011).
 *
 * A `ReferenceAdapter`: it writes `mid_market`, `mid_market_src` and
 * `mid_market_at` onto the `runs` row of its own cycle, and never into `quotes`.
 * It runs in the same cycle as everything else, never on a schedule of its own
 * (Art. III.5, RF-04): a margin computed against a rate from a different moment
 * is not a margin.
 *
 * This is the analytical baseline — the foundation of HU-08 — and the reason it
 * exists separately from the TRM, which is a single daily number frozen across
 * weekends and holidays (Art. III.5).
 *
 * ---
 *
 * ## Primary, fallback, and saying which answered
 *
 * Yahoo first, `open.er-api.com` second. `mid_market_src` always records which
 * one produced the number, because 'yahoo' and 'er_api' are not the same
 * measurement: Yahoo is intraday, er-api is a daily snapshot. A margin series
 * that silently mixes them would show steps that belong to the source and not
 * to the market.
 *
 * **Yahoo answers a plain identifiable User-Agent.** Verified 2026-09-13:
 * a 200 with `INGEST_USER_AGENT` as-is. There is no need to impersonate a
 * browser, and doing so would violate Art. V.4.
 *
 * ## `mid_market_at` is the moment of the datum, not of the capture
 *
 * Yahoo states it in `meta.regularMarketTime`; er-api in
 * `time_last_update_unix`. Neither is "now", and the gap between them and
 * `captured_at` is information rather than noise.
 *
 * **A caveat, measured rather than assumed.** On Sunday 2026-09-13, with the FX
 * market closed, Yahoo's latest point was timestamped that same Sunday at
 * 20:00Z — **not** the Friday session close, which was 2026-09-11T22:59Z. Two
 * requests minutes apart returned the identical `regularMarketTime`, so it is
 * not a live-ticking clock either; it looks bucketed.
 *
 * The consequence matters for T019: `mid_market_at` alone does NOT separate "the
 * market is closed" from "our ingest is stuck". Over a weekend it will sit
 * minutes behind `captured_at`, not days. The signal that distinguishes them is
 * the pair across runs — a stuck ingest repeats the same `mid_market_at` AND the
 * same value, while a closed market can advance the timestamp while the price
 * holds. Whichever it is, nothing is interpolated: a frozen rate is the correct
 * answer, and the hole stays a hole (Art. I.4).
 */

import type { Reference, ReferenceAdapter } from '../contract.ts';
import { type HttpOptions, httpJson } from '../http.ts';

export const YAHOO_URL =
  'https://query1.finance.yahoo.com/v8/finance/chart/USDCOP=X?interval=1d&range=5d';

export const ER_API_URL = 'https://open.er-api.com/v6/latest/USD';

export type YahooResponse = {
  chart?: {
    result?: Array<{
      meta?: { regularMarketPrice?: number; regularMarketTime?: number };
    }>;
    error?: unknown;
  };
};

export type ErApiResponse = {
  result?: string;
  time_last_update_unix?: number;
  rates?: Record<string, number>;
};

function toIso(unixSeconds: number): string {
  const date = new Date(unixSeconds * 1000);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`mid_market: unreadable timestamp ${unixSeconds}`);
  }
  return date.toISOString();
}

function usableRate(value: unknown, where: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    // Never a zero, never a guess: a rate we cannot read is a failed source
    // (Art. I.1). Downstream this is a `sources_failed` entry, not a row.
    throw new Error(`mid_market: ${where} is not a usable rate: ${String(value)}`);
  }
  return value;
}

export function parseYahoo(body: YahooResponse): Reference {
  const meta = body.chart?.result?.[0]?.meta;
  if (meta === undefined) {
    throw new Error('mid_market: Yahoo returned no result');
  }

  const value = usableRate(meta.regularMarketPrice, 'yahoo regularMarketPrice');

  if (typeof meta.regularMarketTime !== 'number') {
    // Without the moment of the datum we cannot tell a stale rate from a fresh
    // one, which is the entire point of the column (Art. I.3 in spirit).
    throw new Error('mid_market: Yahoo gave a price with no regularMarketTime');
  }

  return {
    kind: 'mid_market',
    value,
    source: 'yahoo',
    observed_at: toIso(meta.regularMarketTime),
    raw: body,
  };
}

export function parseErApi(body: ErApiResponse): Reference {
  if (body.result !== 'success') {
    throw new Error(`mid_market: er-api did not report success: ${String(body.result)}`);
  }

  const value = usableRate(body.rates?.['COP'], 'er-api rates.COP');

  if (typeof body.time_last_update_unix !== 'number') {
    throw new Error('mid_market: er-api gave a rate with no time_last_update_unix');
  }

  return {
    kind: 'mid_market',
    value,
    source: 'er_api',
    observed_at: toIso(body.time_last_update_unix),
    raw: body,
  };
}

export type MidMarketOptions = HttpOptions & {
  /** Called when the primary fails and the fallback is about to be tried. */
  onFallback?: (error: Error) => void;
};

export function createMidMarketAdapter(options: MidMarketOptions = {}): ReferenceAdapter {
  const { onFallback, ...http } = options;

  return {
    id: 'mid_market',
    kind: 'reference',
    fetchReference: async (): Promise<Reference> => {
      try {
        return parseYahoo(await httpJson<YahooResponse>(YAHOO_URL, http));
      } catch (primaryError) {
        const error =
          primaryError instanceof Error ? primaryError : new Error(String(primaryError));
        onFallback?.(error);

        try {
          return parseErApi(await httpJson<ErApiResponse>(ER_API_URL, http));
        } catch (fallbackError) {
          // Both down is a real incident, and the message has to name both or
          // the run log will only ever accuse the fallback.
          const second =
            fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
          throw new Error(
            `mid_market: both sources failed. yahoo: ${error.message} | er_api: ${second}`,
          );
        }
      }
    },
  };
}
