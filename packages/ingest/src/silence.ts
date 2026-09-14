/**
 * The silence alarm (T019).
 *
 * The real failure mode of this project is not a crash: it is an adapter that
 * quietly returns stale data for weeks (Art. VI). A crash is loud. Silence is
 * not, and nothing else in the system notices it.
 *
 * Two different kinds of silence are detected here, and they need different
 * evidence.
 *
 * ---
 *
 * ## 1. A provider with no rows
 *
 * Straightforward: `quotes` has nothing for that provider inside the window.
 * This works precisely because a failed query writes no row (Art. I.2) — if
 * failures wrote placeholder rows, absence would never mean absence and this
 * check would be meaningless.
 *
 * ## 2. A reference that stopped moving
 *
 * **This one cannot be decided from a single run**, and the obvious version of
 * it is wrong. Measured in T011: on a Sunday with the FX market shut, Yahoo
 * still returned a datum timestamped minutes before the capture. So "the datum
 * is old" never fires — not for a closed market, and not for a stuck ingest
 * either, since a stuck ingest also reports a recent-looking timestamp.
 *
 * The signal is repetition across runs, reading the timestamp and the value
 * together:
 *
 * | Across N runs | `mid_market_at` | `mid_market` | Verdict |
 * |---|---|---|---|
 * | Stuck ingest | identical | identical | **incident** |
 * | Closed market | may advance | still | normal, left alone |
 * | Open market | advances | moves | healthy |
 *
 * A still value on its own means nothing: a whole weekend produces one
 * legitimately, and Art. I.4 requires leaving it still rather than
 * interpolating. What is not legitimate is the timestamp never changing.
 *
 * ## 3. The ingest itself not running
 *
 * **Added 2026-09-14, after this file passed green through a real outage.**
 *
 * Checks 1 and 2 both ask "is the newest datum recent enough?". Neither can
 * see a hole that has already closed: `findSilentProviders` keeps only the
 * *most recent* sighting per provider, so an outage of any length is invisible
 * the moment one run lands afterwards. Measured on the real data — at the worst
 * instant of an 81-minute hole, 0 of 8 providers read as silent, and with the
 * cron down for 2h39m the report still said nothing was wrong.
 *
 * That is the false green this repo keeps warning about: a check that cannot
 * tell "everything is fine" from "the ingest was dead and just came back".
 *
 * So cadence is checked directly, against the schedule rather than against the
 * data: how long since the last run, and what holes are inside the window. Note
 * this is **wider than Art. VI.2**, whose unit is "a source with no data across
 * N runs" — when nothing runs at all, no source is mute in that sense, and the
 * article's check is vacuously satisfied. The whole system being down was
 * simply outside what it describes.
 */

/** Six hours, per the task. */
export const SILENCE_HOURS = 6;

/** How many consecutive identical runs count as stuck rather than quiet. */
export const STUCK_RUNS = 3;

/** How often the ingest is meant to run. Mirrors the cron in ingest.yml. */
export const EXPECTED_INTERVAL_MINUTES = 15;

/**
 * How big a hole has to be before it is an incident rather than GitHub being
 * GitHub. Actions queues scheduled runs and drops them under load, and
 * documents that it does not guarantee the interval, so one or two missed
 * cycles are normal and alarming on them would train everyone to ignore this.
 *
 * Four missed cycles is not noise. It also matches the staleness threshold
 * T026 shows in the interface, so the alarm and the UI agree on what "stale"
 * means instead of drifting apart.
 */
export const TOLERATED_GAP_MINUTES = 60;

export type QuoteSighting = { provider_id: string; captured_at: string };

export type RunSighting = {
  started_at: string;
  mid_market: number | null;
  mid_market_at: string | null;
};

export type SilentProvider = { providerId: string; lastSeen: string | undefined; hoursAgo: number };

/**
 * Providers with no row inside the window.
 *
 * `expected` comes from the registry rather than from the database: a provider
 * that has never produced a single row would otherwise be invisible, which is
 * the worst case rather than an edge case.
 */
export function findSilentProviders(
  expected: readonly string[],
  sightings: readonly QuoteSighting[],
  now: Date = new Date(),
  hours: number = SILENCE_HOURS,
): SilentProvider[] {
  const cutoff = now.getTime() - hours * 3_600_000;
  const lastSeen = new Map<string, number>();

  for (const sighting of sightings) {
    const at = Date.parse(sighting.captured_at);
    if (Number.isNaN(at)) continue;
    const current = lastSeen.get(sighting.provider_id);
    if (current === undefined || at > current) lastSeen.set(sighting.provider_id, at);
  }

  const silent: SilentProvider[] = [];

  for (const providerId of expected) {
    const seen = lastSeen.get(providerId);
    if (seen !== undefined && seen >= cutoff) continue;

    silent.push({
      providerId,
      lastSeen: seen === undefined ? undefined : new Date(seen).toISOString(),
      hoursAgo: seen === undefined ? Number.POSITIVE_INFINITY : (now.getTime() - seen) / 3_600_000,
    });
  }

  return silent;
}

export type ReferenceVerdict =
  | { kind: 'healthy' }
  | { kind: 'market_closed'; runs: number }
  | { kind: 'stuck'; runs: number; since: string; value: number }
  | { kind: 'not_enough_runs'; runs: number };

/**
 * Decides whether the mid-market reference is stuck, or merely quiet.
 *
 * `runs` must arrive newest first. Only the most recent `STUCK_RUNS` are
 * considered: an incident is about now, not about the week.
 */
export function inspectReference(
  runs: readonly RunSighting[],
  minimumRuns: number = STUCK_RUNS,
): ReferenceVerdict {
  const usable = runs.filter((run) => run.mid_market !== null && run.mid_market_at !== null);

  if (usable.length < minimumRuns) return { kind: 'not_enough_runs', runs: usable.length };

  const window = usable.slice(0, minimumRuns);
  const first = window[0];
  if (first === undefined) return { kind: 'not_enough_runs', runs: 0 };

  const sameTimestamp = window.every((run) => run.mid_market_at === first.mid_market_at);
  const sameValue = window.every((run) => run.mid_market === first.mid_market);

  // The timestamp frozen across runs is the thing that cannot happen while the
  // ingest is working, whatever the market is doing.
  if (sameTimestamp && sameValue) {
    return {
      kind: 'stuck',
      runs: window.length,
      since: first.mid_market_at ?? '',
      value: first.mid_market ?? 0,
    };
  }

  // The price holding while the clock moves is what a closed market looks
  // like. It is normal, and nothing is interpolated over it (Art. I.4).
  if (sameValue) return { kind: 'market_closed', runs: window.length };

  return { kind: 'healthy' };
}

/**
 * A hole in the run history. A database with no runs at all produces none:
 * that case is already covered, loudly, by every provider reading as "no rows
 * at all, ever".
 */
export type Gap = { from: string; to: string; minutes: number; missedCycles: number };

/**
 * Holes in the cadence, including the open one that runs up to `now`.
 *
 * The trailing hole is the one that matters for an alarm: it is the only way to
 * notice that the ingest is down **while it is still down**. The historical
 * ones matter because a check that runs after recovery would otherwise report
 * a clean bill for a period it never covered.
 *
 * `runs` may arrive in any order.
 */
export function findGaps(
  runs: readonly RunSighting[],
  now: Date = new Date(),
  toleratedMinutes: number = TOLERATED_GAP_MINUTES,
): Gap[] {
  const times = runs
    .map((run) => Date.parse(run.started_at))
    .filter((time) => !Number.isNaN(time))
    .sort((a, b) => a - b);

  const gaps: Gap[] = [];
  const record = (from: number, to: number): void => {
    const minutes = (to - from) / 60_000;
    if (minutes <= toleratedMinutes) return;
    gaps.push({
      from: new Date(from).toISOString(),
      to: new Date(to).toISOString(),
      minutes,
      missedCycles: Math.floor(minutes / EXPECTED_INTERVAL_MINUTES) - 1,
    });
  };

  for (let i = 1; i < times.length; i += 1) {
    const from = times[i - 1];
    const to = times[i];
    if (from !== undefined && to !== undefined) record(from, to);
  }

  // The open hole. Without this the alarm can only ever describe the past,
  // which is the whole defect this function exists to close.
  const newest = times[times.length - 1];
  if (newest !== undefined) record(newest, now.getTime());

  return gaps;
}

export type SilenceReport = {
  silentProviders: SilentProvider[];
  reference: ReferenceVerdict;
  gaps: Gap[];
  problems: string[];
};

export function buildReport(
  expected: readonly string[],
  sightings: readonly QuoteSighting[],
  runs: readonly RunSighting[],
  now: Date = new Date(),
): SilenceReport {
  const silentProviders = findSilentProviders(expected, sightings, now);
  const reference = inspectReference(runs);
  const gaps = findGaps(runs, now);
  const problems: string[] = [];

  for (const provider of silentProviders) {
    problems.push(
      provider.lastSeen === undefined
        ? `${provider.providerId}: no rows at all, ever`
        : `${provider.providerId}: no rows for ${provider.hoursAgo.toFixed(1)}h (last ${provider.lastSeen})`,
    );
  }

  if (reference.kind === 'stuck') {
    problems.push(
      `mid_market has repeated the same timestamp AND value across ${reference.runs} runs ` +
        `(${reference.since}, ${reference.value}) — that is a stuck ingest, not a closed market`,
    );
  }

  for (const gap of gaps) {
    const open = gap.to === now.toISOString();
    problems.push(
      open
        ? `the ingest has not run for ${gap.minutes.toFixed(0)} min ` +
            `(last ${gap.from}, about ${gap.missedCycles} cycle(s) missed) — it is down right now`
        : `no run between ${gap.from} and ${gap.to}: ${gap.minutes.toFixed(0)} min, ` +
            `about ${gap.missedCycles} cycle(s) missed`,
    );
  }

  return { silentProviders, reference, gaps, problems };
}
