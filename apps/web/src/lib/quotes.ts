/**
 * The data client (T023). Server only.
 *
 * ## Why this is hand-rolled instead of using `@supabase/supabase-js`
 *
 * Because of N4. Supabase cannot bind a key to a Postgres role, so
 * `SUPABASE_SERVER_READ_KEY` holds a key that can also **write, delete and do
 * DDL** — and `quotes` is the one irrecoverable thing in this project. A
 * supabase-js client hands you `.insert()` and `.delete()` on the same object
 * you read with; the only thing standing between a careless line and an empty
 * table is that nobody types it.
 *
 * This module exposes exactly one function and it reads. There is no write
 * surface to misuse, which is the project's usual preference: make the mistake
 * impossible rather than detectable.
 *
 * ## Why `raw` is excluded, explicitly
 *
 * `latest_quotes` is `q.*` plus the run's references, so `select=*` includes
 * the `raw` jsonb. Measured 2026-09-15: **440 KB with it, 55 KB without — 87.6%
 * of the payload**, on a page whose main case is a phone (RF-12). It also
 * carries every captured response back out of the database for no reason.
 *
 * ## Why every row, in one request
 *
 * plan.md §2.3 and N4: there is no public read, so the browser cannot query.
 * The server sends all four brackets on the initial load and the selector
 * filters in the client without going back. That is bounded by construction —
 * the view is `distinct on (provider, direction, bracket, payment_method)`, so
 * at most 88 rows exist: 7 providers × 2 × 4, plus Eldorado's 4 methods × 2 × 4.
 * Measured: 74.
 *
 * It is bounded, but it is asserted anyway. PostgREST silently caps a result
 * set, and on 2026-09-15 that cap turned a healthy alarm into a false red by
 * dropping 924 of 1924 rows without a word. A cap that is never reached costs
 * nothing; a cap that is reached silently costs a day.
 */

/**
 * One row of `latest_quotes`, minus what the browser has no use for.
 *
 * `id` and `run_id` are internal bookkeeping; `raw` is the captured response.
 * Everything else is either shown or used to sort.
 */
export type LatestQuote = {
  provider_id: string;
  mode: 'local' | 'remesa';
  asset: 'usd' | 'usdt' | 'usdc';
  channel: 'exchange' | 'p2p' | 'bank_transfer' | 'fintech';
  direction: 'cop_to_usd' | 'usd_to_cop';
  bracket_usd: number;
  payment_method: string | null;

  fixed_side: 'in' | 'out';
  amount_in: number | null;
  currency_in: 'COP' | 'USD' | null;
  amount_out: number | null;
  currency_out: 'COP' | 'USD' | null;

  status: 'ok' | 'out_of_range';
  limit_reason: 'below_minimum' | 'above_maximum' | 'insufficient_liquidity' | null;

  gross_rate: number | null;
  /** Pesos per dollar actually paid or received. What Art. III.1 ranks by. */
  effective_rate: number | null;
  fee_pct: number | null;
  fee_fixed_usd: number | null;
  fee_amount_usd: number | null;
  amounts_source: 'provider' | 'computed';
  eta_minutes: number | null;

  captured_at: string;

  /** The references the run held. Positive margin always means worse. */
  trm: number | null;
  trm_from: string | null;
  trm_to: string | null;
  mid_market: number | null;
  mid_market_src: 'yahoo' | 'er_api' | null;
  mid_market_at: string | null;
  markup_vs_trm: number | null;
  markup_vs_mid: number | null;
};

/** Named so the `select` and the type cannot drift apart unnoticed. */
const COLUMNS = [
  'provider_id',
  'mode',
  'asset',
  'channel',
  'direction',
  'bracket_usd',
  'payment_method',
  'fixed_side',
  'amount_in',
  'currency_in',
  'amount_out',
  'currency_out',
  'status',
  'limit_reason',
  'gross_rate',
  'effective_rate',
  'fee_pct',
  'fee_fixed_usd',
  'fee_amount_usd',
  'amounts_source',
  'eta_minutes',
  'captured_at',
  'trm',
  'trm_from',
  'trm_to',
  'mid_market',
  'mid_market_src',
  'mid_market_at',
  'markup_vs_trm',
  'markup_vs_mid',
] as const;

/**
 * Comfortably above the 88 the view can produce, and low enough that hitting it
 * means something changed rather than that the product grew.
 */
const ROW_CAP = 500;

export type QuoteFetch =
  | { kind: 'ok'; quotes: LatestQuote[] }
  /** The query worked and there is nothing inside the view's 24-hour window. */
  | { kind: 'empty' }
  | { kind: 'failed'; reason: string };

function readConfig(): { url: string; key: string } | undefined {
  // process.env, never import.meta.env: the latter is substituted at build
  // time and would bake this key into the deployed artefact. Measured
  // 2026-09-15; env-discipline.test.ts keeps it that way.
  const url = process.env['SUPABASE_URL'];
  const key = process.env['SUPABASE_SERVER_READ_KEY'];
  return url !== undefined && url !== '' && key !== undefined && key !== ''
    ? { url, key }
    : undefined;
}

/**
 * Every current quote, in one request.
 *
 * Never throws. A page that cannot reach the database should say so, not return
 * a 500 — the ingest is unaffected either way (HU-07), and a comparator with no
 * numbers is still allowed to explain itself.
 */
export async function fetchLatestQuotes(signal?: AbortSignal): Promise<QuoteFetch> {
  const config = readConfig();
  if (config === undefined) {
    return {
      kind: 'failed',
      reason: 'SUPABASE_URL or SUPABASE_SERVER_READ_KEY is not set',
    };
  }

  const query = new URLSearchParams({
    select: COLUMNS.join(','),
    // Stable order so the page does not reshuffle between requests for reasons
    // the reader cannot see. The ranking itself is applied above this.
    order: 'mode.asc,direction.asc,bracket_usd.asc,provider_id.asc,payment_method.asc',
    limit: String(ROW_CAP),
  });

  let response: Response;
  try {
    response = await fetch(`${config.url}/rest/v1/latest_quotes?${query}`, {
      headers: {
        apikey: config.key,
        authorization: `Bearer ${config.key}`,
        accept: 'application/json',
      },
      ...(signal === undefined ? {} : { signal }),
    });
  } catch (error) {
    return { kind: 'failed', reason: error instanceof Error ? error.message : String(error) };
  }

  if (!response.ok) {
    return { kind: 'failed', reason: `HTTP ${response.status} from PostgREST` };
  }

  const quotes = (await response.json()) as LatestQuote[];

  if (quotes.length >= ROW_CAP) {
    // Not a crash, but not silence either. The view cannot produce this many,
    // so reaching it means the view changed or the cap is being applied
    // somewhere else — and a truncated ranking is a wrong ranking.
    return {
      kind: 'failed',
      reason: `got ${quotes.length} rows, at or above the cap of ${ROW_CAP}: the result may be truncated`,
    };
  }

  return quotes.length === 0 ? { kind: 'empty' } : { kind: 'ok', quotes };
}

/** The columns asked for, exposed so a test can hold them against the type. */
export const __columns = COLUMNS;
