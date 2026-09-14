/**
 * A live round trip through `db.ts` (T008).
 *
 * The unit tests cover the translation; this covers everything they cannot: the
 * four PostgREST calls, whether the service_role key can actually write through
 * RLS, and whether `raw` survives the trip unchanged.
 *
 * **It leaves the database as it found it.** Everything hangs off one `runs`
 * row, and deleting that row cascades to its quotes (`on delete cascade`,
 * plan.md §2). The script counts both tables before and after and fails loudly
 * if the numbers do not match, so a half-cleaned run is an error rather than a
 * surprise a week later. The history stays immutable because nothing is left
 * behind to be part of it.
 *
 * It borrows a real `provider_id` — the foreign key requires one — and writes a
 * single quote.
 */

import { isDeepStrictEqual } from 'node:util';
import type { Quote, Reference } from '../contract.ts';
import { createSupabaseRunStore } from '../db.ts';
import { createServiceRoleClient } from '../lib/supabase.ts';

const BORROWED_PROVIDER = 'bitso';

/**
 * Deliberately awkward. If `raw` is going to be mangled, it will be by one of
 * these: nested structure, an array, a unicode string, a float with more digits
 * than a double renders casually, an explicit null, a boolean, and empty
 * containers.
 */
const RAW_PAYLOAD = {
  ticker: 'usdt_cop',
  nested: { book: { asks: [1, 2, 3], bids: [] }, depth: 0 },
  unicode: 'peso colombiano — $ 4.012,34 · ñ · 🇨🇴',
  precise: 3080.123456789,
  explicitNull: null,
  flag: true,
  emptyObject: {},
  emptyArray: [],
};

const failures: string[] = [];

function check(condition: boolean, message: string): void {
  if (condition) {
    console.log(`  ok    ${message}`);
  } else {
    console.log(`  FAIL  ${message}`);
    failures.push(message);
  }
}

async function countRows(
  supabase: ReturnType<typeof createServiceRoleClient>,
  table: string,
): Promise<number> {
  const { count, error } = await supabase.from(table).select('*', { count: 'exact', head: true });
  if (error) throw new Error(`could not count ${table}: ${error.message}`);
  return count ?? 0;
}

async function main(): Promise<void> {
  const supabase = createServiceRoleClient();
  const store = createSupabaseRunStore();

  console.log('before:');
  const runsBefore = await countRows(supabase, 'runs');
  const quotesBefore = await countRows(supabase, 'quotes');
  console.log(`  runs ${runsBefore}, quotes ${quotesBefore}`);

  let runId: string | undefined;

  try {
    // --- 1. openRun: an insert into `runs` with the service_role key, through
    //        RLS that has no policies at all. T005 only ever proved that anon
    //        CANNOT write; this is the other half.
    console.log('');
    console.log('writing with the service_role key, through RLS:');
    runId = await store.openRun();
    check(typeof runId === 'string' && runId.length > 0, `openRun inserted a row (${runId})`);

    // --- 2. saveReferences: an update on that same row.
    const references: Reference[] = [
      {
        kind: 'trm',
        value: 4012.34,
        source: 'datos_gov',
        valid_from: '2026-09-12',
        valid_to: '2026-09-15',
        raw: {},
      },
      {
        kind: 'mid_market',
        value: 3990.5,
        source: 'er_api',
        observed_at: '2026-09-13T16:00:00.000Z',
        raw: {},
      },
    ];
    await store.saveReferences(runId, references);
    check(true, 'saveReferences updated the run');

    // --- 3. saveQuotes: an insert into `quotes`.
    const quote: Quote = {
      provider_id: BORROWED_PROVIDER,
      mode: 'local',
      asset: 'usdt',
      channel: 'exchange',
      direction: 'usd_to_cop',
      bracket_usd: 100,
      fixed_side: 'in',
      status: 'ok',
      in: { amount: 100, currency: 'USD' },
      out: { amount: 308_000, currency: 'COP' },
      gross_rate: 3080,
      amounts_source: 'computed',
      raw: RAW_PAYLOAD,
      captured_at: '2026-09-13T17:00:00.000Z',
    };
    await store.saveQuotes(runId, [quote]);
    check(true, 'saveQuotes inserted the quote');

    // --- 4. closeRun: the summary.
    await store.closeRun(runId, {
      sourcesOk: [BORROWED_PROVIDER, 'trm'],
      sourcesFailed: {
        broken_source: {
          kind: 'http',
          message: 'fake failure for the round trip',
          status: 504,
          attempts: 4,
        },
      },
    });
    check(true, 'closeRun wrote the summary');

    // --- Read it all back.
    console.log('');
    console.log('reading it back:');

    const { data: runRow, error: runError } = await supabase
      .from('runs')
      .select('*')
      .eq('id', runId)
      .single();
    if (runError) throw new Error(`could not read the run back: ${runError.message}`);

    const run = runRow as Record<string, unknown>;
    check(Number(run['trm']) === 4012.34, 'trm survived');
    check(run['trm_to'] === '2026-09-15', 'trm_to survived');
    check(Number(run['mid_market']) === 3990.5, 'mid_market survived');
    check(run['mid_market_src'] === 'er_api', 'mid_market_src survived');
    check(run['finished_at'] !== null, 'finished_at was set on close');
    check(
      Array.isArray(run['sources_ok']) && (run['sources_ok'] as string[]).length === 2,
      'sources_ok survived as an array',
    );
    check(
      (run['sources_failed'] as Record<string, { status?: number }>)['broken_source']?.status ===
        504,
      'sources_failed survived as jsonb, with the status intact',
    );

    const { data: quoteRows, error: quoteError } = await supabase
      .from('quotes')
      .select('*')
      .eq('run_id', runId);
    if (quoteError) throw new Error(`could not read the quote back: ${quoteError.message}`);

    const rows = (quoteRows ?? []) as Array<Record<string, unknown>>;
    check(rows.length === 1, `exactly one quote came back (${rows.length})`);

    const row = rows[0];
    if (row !== undefined) {
      check(Number(row['amount_in']) === 100, 'amount_in survived');
      check(Number(row['amount_out']) === 308_000, 'amount_out survived');
      check(row['currency_out'] === 'COP', 'currency_out survived');
      check(row['status'] === 'ok', 'status survived');

      // The undefined -> null translation, confirmed against the real column
      // rather than against the object we built.
      check(row['fee_pct'] === null, 'fee_pct came back null, not 0 (Art. I.1)');
      check(row['fee_fixed_usd'] === null, 'fee_fixed_usd came back null, not 0');
      check(row['limit_reason'] === null, 'limit_reason came back null on an ok row');
      check(row['payment_method'] === null, 'payment_method came back null');

      // --- raw, the whole point of the exercise.
      console.log('');
      console.log('raw survived the round trip:');
      const raw = row['raw'];

      // Deep equality is the real invariant, and the reason is worth stating:
      // `raw` is jsonb, and PostgreSQL's jsonb does not preserve key order — it
      // sorts keys by length, then bytewise. Every VALUE survives; the literal
      // bytes the source sent do not. Asserting byte-identity here would be
      // asserting something the storage type never promised.
      //
      // It matters for one thing only: "we stored exactly what they sent" is
      // true of the content, not of the encoding. If byte-exact provenance is
      // ever needed — verifying a signature, say — jsonb is the wrong column
      // type and a separate text column would be required.
      check(isDeepStrictEqual(raw, RAW_PAYLOAD), 'raw is deep-equal: every value survived');

      const sentOrder = Object.keys(RAW_PAYLOAD).join(',');
      const backOrder = Object.keys(raw as object).join(',');
      if (sentOrder !== backOrder) {
        console.log('  note  jsonb reordered the keys, as it always does:');
        console.log(`          sent: ${sentOrder}`);
        console.log(`          back: ${backOrder}`);
      }
      const returned = raw as typeof RAW_PAYLOAD;
      check(returned.unicode === RAW_PAYLOAD.unicode, 'unicode and emoji intact');
      check(returned.precise === RAW_PAYLOAD.precise, 'the float kept every digit');
      check(returned.explicitNull === null, 'an explicit null stayed null');
      check(returned.flag === true, 'the boolean stayed a boolean');
      check(
        Array.isArray(returned.nested.book.asks) && returned.nested.book.asks.length === 3,
        'the nested array survived',
      );
      check(
        Array.isArray(returned.emptyArray) && returned.emptyArray.length === 0,
        'the empty array stayed an array, not an object',
      );
      check(
        typeof returned.emptyObject === 'object' && !Array.isArray(returned.emptyObject),
        'the empty object stayed an object',
      );
    }
  } finally {
    // --- Clean up, whatever happened above.
    if (runId !== undefined) {
      console.log('');
      console.log('cleaning up:');
      const { error } = await supabase.from('runs').delete().eq('id', runId);
      if (error) {
        console.error(`  COULD NOT DELETE RUN ${runId}: ${error.message}`);
        failures.push(`cleanup failed, run ${runId} is still in the database`);
      } else {
        check(true, `deleted run ${runId}`);
      }
    }
  }

  const runsAfter = await countRows(supabase, 'runs');
  const quotesAfter = await countRows(supabase, 'quotes');
  console.log(`  runs ${runsAfter}, quotes ${quotesAfter}`);

  check(runsAfter === runsBefore, `runs is back to ${runsBefore}`);
  check(
    quotesAfter === quotesBefore,
    `quotes is back to ${quotesBefore} — the cascade took the quote with the run`,
  );

  console.log('');
  if (failures.length > 0) {
    console.error(`ROUND TRIP FAILED (${failures.length}): ${failures.join('; ')}`);
    process.exitCode = 1;
    return;
  }

  console.log('Round trip OK: four PostgREST calls, service_role writes through RLS,');
  console.log('every raw value intact, and the database is exactly as it was found.');
}

await main();
