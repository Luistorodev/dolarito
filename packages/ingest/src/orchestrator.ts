/**
 * The orchestrator (T008).
 *
 * Opens a row in `runs`, resolves the references first so they land on that
 * same row, then the quote adapters, and closes with `sources_ok` and
 * `sources_failed`.
 *
 * Two rules shape everything here, and both come from Article I:
 *
 *   1. **An adapter that throws writes no rows.** Not an empty result, not a row
 *      marked failed — nothing reaches `quotes`. It only lands in
 *      `sources_failed` (Art. I.2). That is what lets absence in `quotes` mean
 *      real absence, which the silence alarm in T019 depends on.
 *   2. **One adapter is not one provider.** The coverage metric is denominated
 *      in providers lost, summed from each failed adapter's `providerIds`
 *      (plan.md §5.1).
 *
 * Persistence goes through `RunStore` rather than Supabase directly, so the
 * whole run can be exercised without a database — and so that this file stays
 * about orchestration rather than about PostgREST.
 */

import type { Adapter, Quote, QuoteAdapter, Reference, ReferenceAdapter } from './contract.ts';
import { HttpError } from './http.ts';

/**
 * Why a source failed, structured rather than as prose.
 *
 * A free-text message cannot be grouped: "a 504 for ten minutes" and "the
 * response shape changed" are different incidents with different responses, and
 * telling them apart by matching strings is guesswork against messages nobody
 * has seen yet. `HttpError` already knows the status and how many attempts it
 * took; both were being thrown away at the boundary.
 *
 * | `kind` | Means |
 * |---|---|
 * | `http` | The source answered, with a status we would not accept. `status` is set. |
 * | `transport` | No answer at all: timeout, DNS, connection refused. |
 * | `adapter` | We got a response and could not read it — a shape change, most likely. |
 */
export type FailureKind = 'http' | 'transport' | 'adapter';

export type SourceFailure = {
  kind: FailureKind;
  message: string;
  /** Present only for `http`. */
  status?: number;
  /** How many attempts the shared client made before giving up. */
  attempts?: number;
};

export function classifyFailure(error: unknown): SourceFailure {
  if (error instanceof HttpError) {
    return error.status === undefined
      ? { kind: 'transport', message: error.message, attempts: error.attempts }
      : { kind: 'http', message: error.message, status: error.status, attempts: error.attempts };
  }

  // Anything the adapter itself threw: a field missing, a rate that will not
  // parse, a book that came back crossed. In practice this is what a silent
  // format change looks like from here.
  return { kind: 'adapter', message: error instanceof Error ? error.message : String(error) };
}

/** What the orchestrator needs from persistence. `db.ts` implements it. */
export type RunStore = {
  openRun(): Promise<string>;
  saveReferences(runId: string, references: Reference[]): Promise<void>;
  saveQuotes(runId: string, quotes: Quote[]): Promise<void>;
  closeRun(
    runId: string,
    summary: { sourcesOk: string[]; sourcesFailed: Record<string, SourceFailure> },
  ): Promise<void>;
};

export type RunOutcome = {
  runId: string;
  /** Adapter ids that answered. Provider-level coverage derives from these. */
  sourcesOk: string[];
  /** Adapter id to why it failed, classified. */
  sourcesFailed: Record<string, SourceFailure>;
  quotesSaved: number;
  referencesSaved: number;
  /** Providers nobody can see this run, summed from the failed adapters. */
  providersLost: string[];
  /** Modes left with no surviving provider at all. */
  modesEmpty: string[];
  /** Reference kinds that failed. Any one of these is an incident. */
  referencesFailed: string[];
  exitCode: number;
  /** Plain-language reasons the exit code is non-zero. Empty when it is zero. */
  exitReasons: string[];
};

export type RunOptions = {
  adapters: Adapter[];
  store: RunStore;
  brackets: number[];
  /** plan.md §5.1 rule 1: more than half of the eight. */
  maxProvidersLost?: number;
};

const DEFAULT_MAX_PROVIDERS_LOST = 4;

function isQuoteAdapter(adapter: Adapter): adapter is QuoteAdapter {
  return adapter.kind === 'quote';
}

function isReferenceAdapter(adapter: Adapter): adapter is ReferenceAdapter {
  return adapter.kind === 'reference';
}

export async function runIngest(options: RunOptions): Promise<RunOutcome> {
  const { adapters, store, brackets } = options;
  const maxProvidersLost = options.maxProvidersLost ?? DEFAULT_MAX_PROVIDERS_LOST;

  const referenceAdapters = adapters.filter(isReferenceAdapter);
  const quoteAdapters = adapters.filter(isQuoteAdapter);

  const runId = await store.openRun();

  const sourcesOk: string[] = [];
  const sourcesFailed: Record<string, SourceFailure> = {};

  // --- References first: they populate trm and mid_market on this same row.
  const referenceResults = await Promise.allSettled(
    referenceAdapters.map(async (adapter) => ({
      adapter,
      reference: await adapter.fetchReference(),
    })),
  );

  const references: Reference[] = [];
  const referencesFailed: string[] = [];

  referenceResults.forEach((result, index) => {
    const adapter = referenceAdapters[index];
    if (adapter === undefined) return;

    if (result.status === 'fulfilled') {
      references.push(result.value.reference);
      sourcesOk.push(adapter.id);
    } else {
      sourcesFailed[adapter.id] = classifyFailure(result.reason);
      referencesFailed.push(adapter.id);
    }
  });

  if (references.length > 0) await store.saveReferences(runId, references);

  // --- Then the quotes.
  const quoteResults = await Promise.allSettled(
    quoteAdapters.map(async (adapter) => ({
      adapter,
      quotes: await adapter.fetchQuotes(brackets),
    })),
  );

  const quotes: Quote[] = [];
  const failedQuoteAdapters: QuoteAdapter[] = [];

  quoteResults.forEach((result, index) => {
    const adapter = quoteAdapters[index];
    if (adapter === undefined) return;

    if (result.status === 'fulfilled') {
      // Rows from a healthy adapter are kept even if a sibling threw:
      // allSettled is the point, one bad source does not darken the others
      // (Art. II).
      quotes.push(...result.value.quotes);
      sourcesOk.push(adapter.id);
    } else {
      // Deliberately no row of any kind. See rule 1 at the top.
      sourcesFailed[adapter.id] = classifyFailure(result.reason);
      failedQuoteAdapters.push(adapter);
    }
  });

  if (quotes.length > 0) await store.saveQuotes(runId, quotes);

  await store.closeRun(runId, { sourcesOk, sourcesFailed });

  // --- Coverage, counted in providers rather than adapters.
  const providersLost = [...new Set(failedQuoteAdapters.flatMap((a) => a.providerIds))];

  // A mode is empty when every adapter serving it failed. Note that an adapter
  // answering with only `out_of_range` rows does NOT empty its mode: the
  // provider is still visible, saying it does not operate at that amount, which
  // is information rather than silence.
  const survivingByMode = new Map<string, number>();
  for (const adapter of quoteAdapters) {
    const current = survivingByMode.get(adapter.mode) ?? 0;
    const survived = failedQuoteAdapters.includes(adapter) ? 0 : adapter.providerIds.length;
    survivingByMode.set(adapter.mode, current + survived);
  }
  const modesEmpty = [...survivingByMode.entries()]
    .filter(([, surviving]) => surviving === 0)
    .map(([mode]) => mode);

  // --- plan.md §5.1: any one of the three turns the run red.
  const exitReasons: string[] = [];

  if (providersLost.length > maxProvidersLost) {
    exitReasons.push(
      `${providersLost.length} providers lost (more than ${maxProvidersLost}): ` +
        `${providersLost.join(', ')}`,
    );
  }

  for (const mode of modesEmpty) {
    exitReasons.push(
      `mode '${mode}' has no surviving provider — for someone who came for that ` +
        `mode, an empty ranking is indistinguishable from the system not existing`,
    );
  }

  if (referencesFailed.length > 0) {
    exitReasons.push(
      `reference(s) failed: ${referencesFailed.join(', ')} — an incident, not degradation`,
    );
  }

  return {
    runId,
    sourcesOk,
    sourcesFailed,
    quotesSaved: quotes.length,
    referencesSaved: references.length,
    providersLost,
    modesEmpty,
    referencesFailed,
    exitCode: exitReasons.length > 0 ? 1 : 0,
    exitReasons,
  };
}
