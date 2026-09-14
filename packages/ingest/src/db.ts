/**
 * Persistence for the ingest tier (T008).
 *
 * The only place that knows about PostgREST. The orchestrator talks to the
 * `RunStore` interface instead, so a run can be exercised without a database.
 *
 * Two project rules are enforced here rather than trusted:
 *
 *   - **`undefined` in the adapter, `null` in the database** (plan.md §2.1).
 *     The translation happens once, at this boundary, so no adapter has to
 *     remember it.
 *   - **No `UPDATE` on `quotes`, ever.** Only inserts. `runs` is the one table
 *     that gets updated, and only to fill in what the run learns as it goes:
 *     the references when they resolve, and the summary when it closes.
 */

import type { Quote, Reference } from './contract.ts';
import { createServiceRoleClient } from './lib/supabase.ts';
import type { RunStore, SourceFailure } from './orchestrator.ts';

/** Adapter `undefined` becomes database `null`, once, here. */
function orNull<T>(value: T | undefined): T | null {
  return value === undefined ? null : value;
}

function quoteToRow(runId: string, quote: Quote): Record<string, unknown> {
  const amounts =
    quote.status === 'ok'
      ? {
          amount_in: quote.in.amount,
          currency_in: quote.in.currency,
          amount_out: quote.out.amount,
          currency_out: quote.out.currency,
        }
      : {
          amount_in: orNull(quote.in?.amount),
          currency_in: orNull(quote.in?.currency),
          amount_out: orNull(quote.out?.amount),
          currency_out: orNull(quote.out?.currency),
        };

  return {
    run_id: runId,
    provider_id: quote.provider_id,
    mode: quote.mode,
    asset: quote.asset,
    channel: quote.channel,
    direction: quote.direction,
    bracket_usd: quote.bracket_usd,
    payment_method: orNull(quote.payment_method),
    fixed_side: quote.fixed_side,
    ...amounts,
    status: quote.status,
    limit_reason: quote.status === 'out_of_range' ? quote.limit_reason : null,
    gross_rate: orNull(quote.gross_rate),
    fee_pct: orNull(quote.fee_pct),
    fee_fixed_usd: orNull(quote.fee_fixed_usd),
    fee_amount_usd: orNull(quote.fee_amount_usd),
    amounts_source: quote.amounts_source,
    eta_minutes: orNull(quote.eta_minutes),
    raw: quote.raw,
    captured_at: quote.captured_at,
  };
}

/**
 * References write onto the run row itself, not into a table of their own:
 * TRM and the mid-market rate are the instant this run was taken against, not
 * entities that appear in a ranking (plan.md §2).
 */
function referenceToRunFields(reference: Reference): Record<string, unknown> {
  if (reference.kind === 'trm') {
    return {
      trm: reference.value,
      trm_from: orNull(reference.valid_from),
      trm_to: orNull(reference.valid_to),
    };
  }

  return {
    mid_market: reference.value,
    mid_market_src: reference.source,
    mid_market_at: orNull(reference.observed_at),
  };
}

export function createSupabaseRunStore(): RunStore {
  const supabase = createServiceRoleClient();

  return {
    async openRun(): Promise<string> {
      const { data, error } = await supabase.from('runs').insert({}).select('id').single();

      if (error) throw new Error(`could not open a run: ${error.message}`);
      return (data as { id: string }).id;
    },

    async saveReferences(runId: string, references: Reference[]): Promise<void> {
      if (references.length === 0) return;

      const fields: Record<string, unknown> = {};
      for (const reference of references) {
        Object.assign(fields, referenceToRunFields(reference));
      }

      const { error } = await supabase.from('runs').update(fields).eq('id', runId);
      if (error) throw new Error(`could not save references: ${error.message}`);
    },

    async saveQuotes(runId: string, quotes: Quote[]): Promise<void> {
      if (quotes.length === 0) return;

      const rows = quotes.map((quote) => quoteToRow(runId, quote));

      // Insert, never upsert. The unique index is what stops a repeated run
      // from duplicating rows, and a conflict here is a bug worth hearing
      // about rather than papering over.
      const { error } = await supabase.from('quotes').insert(rows);
      if (error) throw new Error(`could not save ${rows.length} quote(s): ${error.message}`);
    },

    async closeRun(
      runId: string,
      summary: { sourcesOk: string[]; sourcesFailed: Record<string, SourceFailure> },
    ): Promise<void> {
      const { error } = await supabase
        .from('runs')
        .update({
          finished_at: new Date().toISOString(),
          sources_ok: summary.sourcesOk,
          sources_failed: summary.sourcesFailed,
        })
        .eq('id', runId);

      if (error) throw new Error(`could not close the run: ${error.message}`);
    },
  };
}

export const __testing = { quoteToRow, referenceToRunFields };
