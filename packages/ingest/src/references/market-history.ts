/**
 * The daily USD/COP history seed (T011b).
 *
 * A one-off load into `market_history`. It never mixes with `runs` or with
 * `quotes`: those are captures of this project's own cycles, this is a series
 * that existed before the project did. `market_history.loaded_at` keeps the two
 * dates apart — `d` is the day the close belongs to, `loaded_at` is when we
 * fetched it — and it is the only table where they differ (plan.md §2.1, N5).
 *
 * It exists for HU-08: margins against the mid-market rate mean little without
 * a baseline of where that rate has been.
 *
 * ---
 *
 * ## The timezone trap, and why it is not handled with an offset
 *
 * Yahoo stamps each daily bar at the START of the session in the exchange's own
 * timezone, and for `USDCOP=X` that exchange is Europe/London. Read naively as
 * UTC, a year of data comes out as **31 Sundays and 22 Fridays** — which is
 * nonsense for an FX series, and nonsense that would have been seeded silently
 * into the entire history.
 *
 * Measured on 2026-09-13 over a year of bars: 152 sit at 23:00Z and 110 at
 * 00:00Z. That is British Summer Time and GMT — the same session start, six
 * months apart. So a single fixed `meta.gmtoffset` is the wrong tool even though
 * it happens to agree on all 263 bars of this particular pull: it agrees only
 * because +1h leaves a 00:00Z bar on its own date and pushes a 23:00Z bar to the
 * next, and that coincidence is not a property anyone should rely on.
 *
 * Converting each bar in `Europe/London` handles the DST switch per bar. With it
 * the year lands as Mon 52, Tue 52, Wed 52, Thu 53, Fri 53 — and exactly one
 * Sunday, which is the incomplete bar for the day in progress.
 */

import { type HttpOptions, httpJson } from '../http.ts';

export const HISTORY_URL =
  'https://query1.finance.yahoo.com/v8/finance/chart/USDCOP=X?interval=1d&range=2y';

export const HISTORY_SRC = 'yahoo_seed';

/** The exchange Yahoo reports for USDCOP=X, and the timezone its bars start in. */
const EXCHANGE_TIMEZONE = 'Europe/London';

export type HistoryResponse = {
  chart?: {
    result?: Array<{
      timestamp?: number[];
      indicators?: { quote?: Array<{ close?: Array<number | null> }> };
    }>;
  };
};

export type HistoryRow = {
  /** The session day, as `YYYY-MM-DD`. */
  d: string;
  close: number;
};

export type ParseHistoryResult = {
  rows: HistoryRow[];
  /** Bars dropped, and why. Reported rather than hidden: gaps are information. */
  skipped: { noClose: number; notYetClosed: number };
};

const LONDON_DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: EXCHANGE_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** The session day a bar belongs to, in the exchange's own timezone. */
export function sessionDate(unixSeconds: number): string {
  return LONDON_DATE.format(new Date(unixSeconds * 1000));
}

export function parseHistory(body: HistoryResponse, now: Date = new Date()): ParseHistoryResult {
  const result = body.chart?.result?.[0];
  const timestamps = result?.timestamp;
  const closes = result?.indicators?.quote?.[0]?.close;

  if (timestamps === undefined || closes === undefined) {
    throw new Error('market_history: Yahoo returned no series');
  }
  if (timestamps.length !== closes.length) {
    throw new Error(
      `market_history: ${timestamps.length} timestamps against ${closes.length} closes`,
    );
  }

  const today = LONDON_DATE.format(now);
  const rows: HistoryRow[] = [];
  const skipped = { noClose: 0, notYetClosed: 0 };

  timestamps.forEach((timestamp, index) => {
    const close = closes[index];

    // A holiday comes back as null. It is skipped, never interpolated and never
    // carried forward from the previous day: the hole stays a hole (Art. I.4).
    if (close === null || close === undefined || !Number.isFinite(close) || close <= 0) {
      skipped.noClose += 1;
      return;
    }

    const d = sessionDate(timestamp);

    // The bar for the session in progress is not a close yet. Seeding it would
    // record a number that is still moving as if it had settled.
    if (d >= today) {
      skipped.notYetClosed += 1;
      return;
    }

    rows.push({ d, close });
  });

  return { rows, skipped };
}

export async function fetchHistory(
  options: HttpOptions = {},
  now: Date = new Date(),
): Promise<ParseHistoryResult> {
  return parseHistory(await httpJson<HistoryResponse>(HISTORY_URL, options), now);
}
