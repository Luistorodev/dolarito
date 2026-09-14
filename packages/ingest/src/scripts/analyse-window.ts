/**
 * The T020 close-out analysis.
 *
 * Answers the six questions CLAUDE.md lists for the end of the accumulation
 * window. Runnable at any point — it says how much data it had rather than
 * pretending a week's worth of confidence from two runs.
 *
 * Read-only. It writes nothing.
 */

import { PROVIDERS } from '../lib/providers.ts';
import { createServiceRoleClient } from '../lib/supabase.ts';

type QuoteRow = {
  run_id: string;
  provider_id: string;
  direction: string;
  bracket_usd: number;
  payment_method: string | null;
  status: string;
  limit_reason: string | null;
  amount_in: number | null;
  amount_out: number | null;
  currency_out: string | null;
  gross_rate: number | null;
  captured_at: string;
};

type RunRow = {
  id: string;
  started_at: string;
  finished_at: string | null;
  trm: number | null;
  mid_market: number | null;
  sources_ok: string[];
  sources_failed: Record<string, string>;
};

const BRACKETS = [1, 100, 500, 1000];
const CADENCE_MINUTES = 15;

function heading(n: number, title: string): void {
  console.log('');
  console.log(`━━━ ${n}. ${title} ${'━'.repeat(Math.max(0, 58 - title.length))}`);
}

/** Pesos per dollar actually paid or received, whichever side the COP is on. */
function effectiveRate(row: QuoteRow): number | null {
  if (row.amount_in === null || row.amount_out === null) return null;
  return row.currency_out === 'COP'
    ? Number(row.amount_out) / Number(row.amount_in)
    : Number(row.amount_in) / Number(row.amount_out);
}

/** The COP side of a row, which is what a ranking is ordered by. */
function copAmount(row: QuoteRow): number | null {
  if (row.amount_in === null || row.amount_out === null) return null;
  return row.currency_out === 'COP' ? Number(row.amount_out) : Number(row.amount_in);
}

async function main(): Promise<void> {
  const supabase = createServiceRoleClient();

  const { data: runData, error: runError } = await supabase
    .from('runs')
    .select('id, started_at, finished_at, trm, mid_market, sources_ok, sources_failed')
    .order('started_at', { ascending: true });
  if (runError) throw new Error(`could not read runs: ${runError.message}`);

  const { data: quoteData, error: quoteError } = await supabase
    .from('quotes')
    .select(
      'run_id, provider_id, direction, bracket_usd, payment_method, status, limit_reason, amount_in, amount_out, currency_out, gross_rate, captured_at',
    );
  if (quoteError) throw new Error(`could not read quotes: ${quoteError.message}`);

  const runs = (runData ?? []) as RunRow[];
  const quotes = (quoteData ?? []) as QuoteRow[];

  const first = runs[0];
  const last = runs[runs.length - 1];
  const spanHours =
    first === undefined || last === undefined
      ? 0
      : (Date.parse(last.started_at) - Date.parse(first.started_at)) / 3_600_000;

  console.log('T020 — window analysis');
  console.log(`runs: ${runs.length}   quotes: ${quotes.length}`);
  if (first !== undefined && last !== undefined) {
    console.log(`from ${first.started_at}`);
    console.log(`to   ${last.started_at}   (${spanHours.toFixed(1)}h)`);
  }
  if (runs.length < 20) {
    console.log('');
    console.log('NOTE: too few runs for any of this to be conclusive. Shapes only.');
  }

  // ── 1 ──────────────────────────────────────────────────────────────────
  heading(1, 'Coverage per source');

  const runsWithProvider = new Map<string, Set<string>>();
  for (const quote of quotes) {
    const set = runsWithProvider.get(quote.provider_id) ?? new Set<string>();
    set.add(quote.run_id);
    runsWithProvider.set(quote.provider_id, set);
  }

  for (const provider of PROVIDERS) {
    const present = runsWithProvider.get(provider.id)?.size ?? 0;
    const pct = runs.length === 0 ? 0 : (present / runs.length) * 100;
    console.log(
      `  ${provider.id.padEnd(15)} ${String(present).padStart(5)} / ${runs.length} runs  ${pct.toFixed(1)}%`,
    );
  }

  const failureCounts = new Map<string, number>();
  const failureSamples = new Map<string, string>();
  for (const run of runs) {
    for (const [adapter, message] of Object.entries(run.sources_failed)) {
      const key = `${adapter}`;
      failureCounts.set(key, (failureCounts.get(key) ?? 0) + 1);
      if (!failureSamples.has(key)) failureSamples.set(key, message);
    }
  }

  console.log('');
  if (failureCounts.size === 0) {
    console.log('  no adapter failures recorded');
  } else {
    console.log('  failures by adapter:');
    for (const [adapter, count] of failureCounts) {
      console.log(`    ${adapter.padEnd(15)} ${count}x   e.g. ${failureSamples.get(adapter)}`);
    }
    console.log('');
    console.log('  NOTE: sources_failed stores a free-text message, not a cause.');
    console.log('  Grouping "a 504" against "a format change" means matching strings.');
  }

  // ── 2 ──────────────────────────────────────────────────────────────────
  heading(2, 'Gaps');

  let gaps = 0;
  let missedCycles = 0;
  for (let i = 1; i < runs.length; i += 1) {
    const previous = runs[i - 1];
    const current = runs[i];
    if (previous === undefined || current === undefined) continue;
    const minutes = (Date.parse(current.started_at) - Date.parse(previous.started_at)) / 60_000;
    if (minutes > CADENCE_MINUTES * 1.5) {
      gaps += 1;
      missedCycles += Math.round(minutes / CADENCE_MINUTES) - 1;
      if (gaps <= 10) {
        console.log(
          `  ${previous.started_at} -> ${current.started_at}  (${minutes.toFixed(0)} min)`,
        );
      }
    }
  }
  console.log(`  ${gaps} gap(s), about ${missedCycles} missed cycle(s)`);

  const crashed = runs.filter((run) => run.finished_at === null);
  console.log(`  ${crashed.length} run(s) opened but never closed (crashed mid-cycle)`);

  console.log('');
  console.log('  brackets that never produced a usable row, per provider:');
  let emptyCells = 0;
  for (const provider of PROVIDERS) {
    for (const bracket of BRACKETS) {
      const rows = quotes.filter((q) => q.provider_id === provider.id && q.bracket_usd === bracket);
      const ok = rows.filter((q) => q.status === 'ok').length;
      if (ok === 0) {
        emptyCells += 1;
        const reasons = [...new Set(rows.map((q) => q.limit_reason ?? 'absent'))];
        console.log(
          `    ${provider.id.padEnd(15)} @${String(bracket).padStart(4)}  ${rows.length} row(s), ${reasons.join('/')}`,
        );
      }
    }
  }
  if (emptyCells === 0) console.log('    none');

  // ── 3 ──────────────────────────────────────────────────────────────────
  heading(3, "Variation across Eldorado's payment methods");

  const eldorado = quotes.filter((q) => q.provider_id === 'eldorado' && q.status === 'ok');
  const cells = new Map<string, Map<string, number>>();
  for (const quote of eldorado) {
    const cop = copAmount(quote);
    if (cop === null || quote.payment_method === null) continue;
    const key = `${quote.run_id}|${quote.direction}|${quote.bracket_usd}`;
    const byMethod = cells.get(key) ?? new Map<string, number>();
    byMethod.set(quote.payment_method, cop);
    cells.set(key, byMethod);
  }

  let identical = 0;
  let differing = 0;
  const spreadByCell: Array<{ direction: string; bracket: number; spreadPct: number }> = [];
  for (const [key, byMethod] of cells) {
    const values = [...byMethod.values()];
    if (values.length < 2) continue;
    const min = Math.min(...values);
    const max = Math.max(...values);
    if (max === min) identical += 1;
    else {
      differing += 1;
      const parts = key.split('|');
      spreadByCell.push({
        direction: parts[1] ?? '',
        bracket: Number(parts[2]),
        spreadPct: ((max - min) / min) * 100,
      });
    }
  }

  console.log(`  cells where all 4 methods priced identically: ${identical}`);
  console.log(`  cells where they differed:                    ${differing}`);
  if (differing > 0) {
    console.log('');
    console.log('  where the difference shows up:');
    const grouped = new Map<string, number[]>();
    for (const cell of spreadByCell) {
      const key = `${cell.direction} @${cell.bracket}`;
      grouped.set(key, [...(grouped.get(key) ?? []), cell.spreadPct]);
    }
    for (const [key, spreads] of grouped) {
      const avg = spreads.reduce((a, b) => a + b, 0) / spreads.length;
      console.log(`    ${key.padEnd(20)} ${spreads.length}x, avg spread ${avg.toFixed(3)}%`);
    }
  }
  console.log('');
  console.log('  VERDICT: if these stay identical across a week, the method list can');
  console.log('  be cut and the §7.1 risk drops with it.');

  // ── 4 ──────────────────────────────────────────────────────────────────
  heading(4, 'How often the Binance P2P book crosses');

  let compared = 0;
  let crossed = 0;
  const crossesByBracket = new Map<number, number>();
  const totalByBracket = new Map<number, number>();

  for (const run of runs) {
    for (const bracket of BRACKETS) {
      const buying = quotes.find(
        (q) =>
          q.run_id === run.id &&
          q.provider_id === 'binance_p2p' &&
          q.direction === 'cop_to_usd' &&
          q.bracket_usd === bracket &&
          q.status === 'ok',
      );
      const selling = quotes.find(
        (q) =>
          q.run_id === run.id &&
          q.provider_id === 'binance_p2p' &&
          q.direction === 'usd_to_cop' &&
          q.bracket_usd === bracket &&
          q.status === 'ok',
      );
      if (buying === undefined || selling === undefined) continue;

      const pay = copAmount(buying);
      const receive = copAmount(selling);
      if (pay === null || receive === null) continue;

      compared += 1;
      totalByBracket.set(bracket, (totalByBracket.get(bracket) ?? 0) + 1);
      if (pay <= receive) {
        crossed += 1;
        crossesByBracket.set(bracket, (crossesByBracket.get(bracket) ?? 0) + 1);
      }
    }
  }

  console.log(`  comparable cells: ${compared}`);
  console.log(
    `  crossed:          ${crossed}  (${compared === 0 ? 0 : ((crossed / compared) * 100).toFixed(1)}%)`,
  );
  for (const bracket of BRACKETS) {
    const total = totalByBracket.get(bracket) ?? 0;
    if (total === 0) continue;
    const n = crossesByBracket.get(bracket) ?? 0;
    console.log(`    @${String(bracket).padStart(4)}  ${n} / ${total}`);
  }
  console.log('');
  console.log('  VERDICT: if this is frequent and concentrated in a bracket, it stops');
  console.log('  being a curiosity and the interface has to explain it (cf. RF-11c).');

  // ── 5 ──────────────────────────────────────────────────────────────────
  heading(5, 'Whether the ranking leader changes with the bracket');

  for (const direction of ['usd_to_cop', 'cop_to_usd']) {
    console.log(`  ${direction}:`);
    const leadersPerRun = new Map<string, Map<number, string>>();

    for (const run of runs) {
      const byBracket = new Map<number, string>();
      for (const bracket of BRACKETS) {
        const rows = quotes.filter(
          (q) =>
            q.run_id === run.id &&
            q.direction === direction &&
            q.bracket_usd === bracket &&
            q.status === 'ok' &&
            copAmount(q) !== null,
        );
        if (rows.length === 0) continue;

        // usd_to_cop: more pesos received wins. cop_to_usd: fewer pesos paid.
        const sorted = [...rows].sort((a, b) => {
          const ca = copAmount(a) ?? 0;
          const cb = copAmount(b) ?? 0;
          return direction === 'usd_to_cop' ? cb - ca : ca - cb;
        });
        const winner = sorted[0];
        if (winner !== undefined) byBracket.set(bracket, winner.provider_id);
      }
      if (byBracket.size > 0) leadersPerRun.set(run.id, byBracket);
    }

    let sameAcrossBrackets = 0;
    let changed = 0;
    const leaderCounts = new Map<string, number>();

    for (const byBracket of leadersPerRun.values()) {
      const leaders = [...byBracket.values()];
      for (const leader of leaders) leaderCounts.set(leader, (leaderCounts.get(leader) ?? 0) + 1);
      if (new Set(leaders).size === 1) sameAcrossBrackets += 1;
      else changed += 1;
    }

    console.log(`    runs where one provider led every bracket: ${sameAcrossBrackets}`);
    console.log(`    runs where the leader changed:             ${changed}`);
    for (const [provider, count] of [...leaderCounts].sort((a, b) => b[1] - a[1])) {
      console.log(`      ${provider.padEnd(15)} led ${count} bracket-run(s)`);
    }
  }
  console.log('');
  console.log('  VERDICT: if the leader never changes, the bracket selector earns little');
  console.log('  and that is worth knowing before building it. If it changes, it is the');
  console.log('  central argument of the product.');

  // ── 6 ──────────────────────────────────────────────────────────────────
  heading(6, 'The two margin defects, measured');

  const runById = new Map(runs.map((run) => [run.id, run]));
  let signFlips = 0;
  let signTotal = 0;
  const feeGaps: Array<{ provider: string; advertised: number; effective: number }> = [];

  for (const quote of quotes) {
    if (quote.status !== 'ok' || quote.gross_rate === null) continue;
    const run = runById.get(quote.run_id);
    if (run?.trm === null || run?.trm === undefined) continue;

    const trm = Number(run.trm);
    const advertisedMarkup = (trm - Number(quote.gross_rate)) / trm;
    const effective = effectiveRate(quote);
    if (effective === null) continue;

    const correctMarkup =
      quote.direction === 'usd_to_cop' ? (trm - effective) / trm : (effective - trm) / trm;

    signTotal += 1;
    if (Math.sign(advertisedMarkup) !== Math.sign(correctMarkup)) signFlips += 1;

    const drift = Math.abs(effective - Number(quote.gross_rate));
    if (drift > 0.01) {
      feeGaps.push({
        provider: quote.provider_id,
        advertised: Number(quote.gross_rate),
        effective,
      });
    }
  }

  console.log(`  rows where the sign flips once corrected: ${signFlips} / ${signTotal}`);
  console.log('');
  console.log('  rows where the advertised rate is not the effective one:');
  const byProvider = new Map<string, { n: number; worst: number }>();
  for (const gap of feeGaps) {
    const current = byProvider.get(gap.provider) ?? { n: 0, worst: 0 };
    const pct = Math.abs((gap.effective - gap.advertised) / gap.advertised) * 100;
    byProvider.set(gap.provider, { n: current.n + 1, worst: Math.max(current.worst, pct) });
  }
  if (byProvider.size === 0) console.log('    none');
  for (const [provider, stats] of byProvider) {
    console.log(
      `    ${provider.padEnd(15)} ${stats.n} row(s), worst drift ${stats.worst.toFixed(2)}%`,
    );
  }
  console.log('');
  console.log('  VERDICT: this is the measurement the fix waits on. The correction is');
  console.log('  already written in plan.md §2.2.');

  console.log('');
}

await main();
