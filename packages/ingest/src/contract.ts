/**
 * The adapter contract (plan.md §3).
 *
 * Every adapter exports a function with one of these signatures. The
 * orchestrator knows nothing else about it. Two adapter kinds exist because
 * references write to `runs`, not to `quotes`.
 *
 * ---
 *
 * One thing here is deliberately stricter than the type listing in plan.md §3,
 * and it is the reason T006 has the done criterion it has: `Quote` is a
 * discriminated union on `status` rather than a flat type with optional `in`
 * and `out`.
 *
 * The flat version cannot reject a quote that claims `status: 'ok'` while
 * carrying no amounts, which is precisely the shape that would write a row
 * asserting an observation we never made. The union makes that unrepresentable
 * instead of merely discouraged (Art. I).
 *
 * The data contract itself is unchanged: same field names, same value types,
 * same optionality on every field the flat version left optional. What changed
 * is only which combinations TypeScript will accept. An `out_of_range` quote
 * keeps `in` and `out` optional, because when a provider refuses a bracket the
 * amounts genuinely are unknown — and `undefined` is the honest answer, never
 * zero (Art. I.1).
 */

export type Money = { amount: number; currency: 'COP' | 'USD' };

/** Everything a quote carries regardless of how it turned out. */
type QuoteCommon = {
  provider_id: string;
  mode: 'local' | 'remesa';
  asset: 'usd' | 'usdt' | 'usdc';
  channel: 'exchange' | 'p2p' | 'bank_transfer' | 'fintech';
  direction: 'cop_to_usd' | 'usd_to_cop';
  bracket_usd: 1 | 100 | 500 | 1000;
  payment_method?: string;

  /** Which side `bracket_usd` denominates. Always the USD side (plan.md §2.1). */
  fixed_side: 'in' | 'out';

  gross_rate?: number;
  fee_pct?: number;
  fee_fixed_usd?: number;
  fee_amount_usd?: number;
  amounts_source: 'provider' | 'computed';
  eta_minutes?: number;

  raw: unknown;
  /** ISO 8601. */
  captured_at: string;
};

/**
 * A real observation: the provider quoted this bracket and both sides are known.
 *
 * `limit_reason` is forbidden rather than merely unused — there is no limit to
 * report on a quote that went through.
 */
type QuoteOk = QuoteCommon & {
  status: 'ok';
  /** What the person hands over. */
  in: Money;
  /** What the person receives. */
  out: Money;
  limit_reason?: never;
};

/**
 * Also a real observation — we know the provider does not operate at this
 * amount, and we have its raw response (plan.md §2.1). A failed *request* is
 * not this: it returns no row at all and is recorded in `runs.sources_failed`
 * (Art. I.2).
 *
 * `limit_reason` is required here: `out_of_range` without a reason is a fact we
 * cannot act on. `in` and `out` stay optional because the provider never
 * quoted them.
 */
type QuoteOutOfRange = QuoteCommon & {
  status: 'out_of_range';
  limit_reason: 'below_minimum' | 'above_maximum' | 'insufficient_liquidity';
  in?: Money;
  out?: Money;
};

export type Quote = QuoteOk | QuoteOutOfRange;

/**
 * TRM and the mid-market rate. Not providers: they never appear in a ranking,
 * and they are written onto the `runs` row of the same cycle (plan.md §2).
 */
export type Reference = {
  kind: 'trm' | 'mid_market';
  value: number;
  /** 'datos_gov' | 'yahoo' | 'er_api' */
  source: string;
  valid_from?: string;
  valid_to?: string;
  /** When the datum is from, not when it was captured. */
  observed_at?: string;
  raw: unknown;
};

export interface QuoteAdapter {
  id: string;
  kind: 'quote';
  mode: 'local' | 'remesa';
  fetchQuotes(brackets: number[]): Promise<Quote[]>;
}

export interface ReferenceAdapter {
  id: string;
  kind: 'reference';
  fetchReference(): Promise<Reference>;
}

export type Adapter = QuoteAdapter | ReferenceAdapter;
