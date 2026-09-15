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

/**
 * How long the mid-market datum may stay frozen before it is an incident
 * whatever the cause.
 *
 * A stale upstream and a caching adapter of our own look **identical** from the
 * database — both show a frozen `mid_market_at` while our runs keep landing.
 * Rather than guess, the verdict says what it can prove and escalates on
 * duration: a couple of hours frozen at an illiquid time is ordinary, twelve is
 * not, and by then somebody has to look regardless of which it turned out to be.
 *
 * Twelve rather than forty-eight because T011 measured that Yahoo advances its
 * timestamp even across a closed weekend. A frozen timestamp is not how a
 * weekend looks here.
 */
export const STALE_REFERENCE_HOURS = 12;

export type QuoteSighting = { provider_id: string; captured_at: string };

export type RunSighting = {
  started_at: string;
  mid_market: number | null;
  mid_market_at: string | null;
  /**
   * Which sources answered. Optional because older callers do not pass it —
   * and when it is missing the reference verdict deliberately errs LOUD, since
   * without it we cannot show our own ingest was healthy.
   */
  sources_ok?: string[] | null | undefined;
  /** The TRM held by this run, and the last day it is valid for. */
  trm?: number | null | undefined;
  trm_to?: string | null | undefined;
};

export type SilentProvider = { providerId: string; lastSeen: string | undefined; hoursAgo: number };

/** Returns the newest `captured_at` for one provider, or undefined if it has none. */
export type LatestSightingFetcher = (providerId: string) => Promise<string | undefined>;

/**
 * One sighting per provider, asked for one provider at a time.
 *
 * **Never fetch the window in bulk.** Doing that produced a false RED on
 * 2026-09-15: PostgREST caps a result set (1000 rows by default), the window
 * held 1924, and the 924 it dropped happened to contain every row of
 * `wise`, `instarem` and `western_union`. The check reported all three as
 * having "no rows at all, ever" while they had written seconds earlier.
 *
 * The bug was not invisible, it was **unreachable**: when this was written the
 * window never held more than a few hundred rows, so no amount of testing
 * against real data would have found it. It appeared the day the ingest started
 * working properly — fixing T018 is what exposed it.
 *
 * A false red is worse than a false green. A green that lies gets believed once;
 * a red that lies teaches everyone to ignore the alarm.
 *
 * Eight one-row queries have no cap to hit, so the failure cannot recur with
 * scale. Cost is bounded by the size of the catalogue, not by the window.
 */
export async function collectSightings(
  expected: readonly string[],
  fetchLatest: LatestSightingFetcher,
): Promise<QuoteSighting[]> {
  const sightings: QuoteSighting[] = [];

  for (const providerId of expected) {
    const captured = await fetchLatest(providerId);
    if (captured !== undefined) sightings.push({ provider_id: providerId, captured_at: captured });
  }

  return sightings;
}

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
  /** Frozen datum, and our ingest is demonstrably alive. Not our fault. */
  | { kind: 'stale_source'; runs: number; since: string; value: number; frozenHours: number }
  /** Frozen datum, and we cannot show our ingest was healthy. Ours to answer for. */
  | { kind: 'stuck'; runs: number; since: string; value: number }
  | { kind: 'not_enough_runs'; runs: number };

/**
 * What the mid-market reference is doing, in three categories rather than two.
 *
 * The two-category version said "that is a stuck ingest, not a closed market"
 * about a frozen datum — and on 2026-09-15 it said exactly that while the
 * ingest was demonstrably fine: 26 runs in six hours, eight of eight sources
 * answering, fresh quotes landing. What was frozen was Yahoo's datum at an
 * illiquid hour, and recording a still rate is the correct answer (Art. I.4).
 *
 * | Across N runs | `mid_market_at` | value | our ingest | verdict |
 * |---|---|---|---|---|
 * | Open market | advances | moves | — | `healthy` |
 * | Closed market | advances | still | — | `market_closed` |
 * | Stale upstream | frozen | frozen | alive | `stale_source` |
 * | Something ours | frozen | frozen | unproven | `stuck` |
 *
 * "Our ingest is alive" means the runs kept coming (`started_at` advances) AND
 * the other sources kept answering. When `sources_ok` is absent we cannot show
 * that, so the verdict errs toward `stuck` — an unknown makes this louder, not
 * quieter.
 *
 * `runs` must arrive newest first. Only the most recent `STUCK_RUNS` count: an
 * incident is about now, not about the week.
 */
export function inspectReference(
  runs: readonly RunSighting[],
  now: Date = new Date(),
  minimumRuns: number = STUCK_RUNS,
): ReferenceVerdict {
  const usable = runs.filter((run) => run.mid_market !== null && run.mid_market_at !== null);

  if (usable.length < minimumRuns) return { kind: 'not_enough_runs', runs: usable.length };

  const window = usable.slice(0, minimumRuns);
  const first = window[0];
  if (first === undefined) return { kind: 'not_enough_runs', runs: 0 };

  const sameTimestamp = window.every((run) => run.mid_market_at === first.mid_market_at);
  const sameValue = window.every((run) => run.mid_market === first.mid_market);

  if (sameTimestamp && sameValue) {
    const since = first.mid_market_at ?? '';
    const value = first.mid_market ?? 0;

    // Did the runs keep coming? Distinct started_at across the window means new
    // captures really happened rather than one row being re-read.
    const startedAt = new Set(window.map((run) => run.started_at));
    const runsKeptComing = startedAt.size === window.length;

    // Did everything else keep answering? Absent information is not evidence
    // of health, so an unset sources_ok fails this deliberately.
    const sourcesAnswered = window.every((run) => (run.sources_ok ?? []).length > 0);

    if (runsKeptComing && sourcesAnswered) {
      const frozenSince = Date.parse(since);
      const frozenHours = Number.isNaN(frozenSince) ? 0 : (now.getTime() - frozenSince) / 3_600_000;
      return { kind: 'stale_source', runs: window.length, since, value, frozenHours };
    }

    return { kind: 'stuck', runs: window.length, since, value };
  }

  // The price holding while the clock moves is what a closed market looks
  // like. It is normal, and nothing is interpolated over it (Art. I.4).
  if (sameValue) return { kind: 'market_closed', runs: window.length };

  return { kind: 'healthy' };
}

/**
 * Colombia is UTC-5 all year: no daylight saving, so one fixed offset is a fact
 * and not a simplification.
 */
const BOGOTA_OFFSET = '-05:00';

/**
 * The instant a TRM stops being valid: midnight in Bogotá at the END of
 * `trm_to`, which is a `date` with no time of day.
 *
 * Reading that date as UTC would declare the rate expired **five hours early**,
 * every single day — the same class of mistake as T011b, where reading Yahoo's
 * daily bars as UTC produced 31 Sundays in a year.
 */
export function trmExpiresAt(trmTo: string): number {
  return Date.parse(`${trmTo}T00:00:00${BOGOTA_OFFSET}`) + 24 * 3_600_000;
}

export type TrmVerdict =
  /** We hold a TRM and it is still valid. */
  | { kind: 'valid'; value: number; until: string; hoursLeft: number }
  /** We hold one, but it expired: we failed to renew before the old one ran out. */
  | { kind: 'expired'; value: number; until: string; hoursStale: number }
  /** We hold none at all. Worse than expired, and it used to look the same. */
  | { kind: 'absent' }
  /** Nobody told us about the TRM. Not a claim that there isn't one. */
  | { kind: 'not_reported' }
  | { kind: 'no_runs' };

/**
 * Is the TRM we are serving still the one in force?
 *
 * **The source declares its own expiry**, so nothing here needs a threshold.
 * Each record carries `vigenciadesde`/`vigenciahasta` and a rate rules until
 * the next one relieves it — the same property that let T010 refuse to carry a
 * calendar of Colombian holidays. A made-up staleness window would be us
 * guessing at something the source already answers.
 *
 * Why the TRM gets its own check at all, when `mid_market` has one: **it is the
 * only source with no fallback.** mid-market falls back from Yahoo to er-api;
 * if datos.gov.co is unreachable there is nowhere else to ask (plan.md §7).
 *
 * A single failed fetch is deliberately NOT an incident — measured 2026-09-15,
 * one 503 in 83 runs, the only failure of any source in the project's history.
 * What matters is not missing one capture: it is **failing to renew before the
 * rate we hold runs out**.
 *
 * `runs` must arrive newest first.
 */
export function inspectTrm(runs: readonly RunSighting[], now: Date = new Date()): TrmVerdict {
  if (runs.length === 0) return { kind: 'no_runs' };

  // A field that was never passed is not evidence of anything. `trm: null`
  // says the fetch failed; an absent key says the caller did not ask about the
  // TRM, and answering "there is none" to that would be inventing a finding.
  // `check-silence.ts` always selects both columns, so production always gets
  // a real verdict — this only keeps callers that do not care from being
  // told about a problem that was never measured.
  const informed = runs.filter((run) => Object.hasOwn(run, 'trm_to'));
  if (informed.length === 0) return { kind: 'not_reported' };

  // The newest run that actually carried a rate. A run that failed to fetch
  // leaves the previous one still in force, so one gap proves nothing.
  const held = informed.find(
    (run) =>
      run.trm !== null && run.trm !== undefined && run.trm_to !== null && run.trm_to !== undefined,
  );

  // Not "the last fetch failed" but "we have no rate at all" — the distinction
  // the caller asked for, because these two used to look identical and the
  // second is much worse: there is nothing to serve, not merely something old.
  if (held === undefined) return { kind: 'absent' };

  const until = String(held.trm_to);
  const expires = trmExpiresAt(until);
  if (Number.isNaN(expires)) return { kind: 'absent' };

  const value = Number(held.trm);
  const millis = expires - now.getTime();

  return millis > 0
    ? { kind: 'valid', value, until, hoursLeft: millis / 3_600_000 }
    : { kind: 'expired', value, until, hoursStale: -millis / 3_600_000 };
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
  trm: TrmVerdict;
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
  const reference = inspectReference(runs, now);
  const gaps = findGaps(runs, now);
  const trm = inspectTrm(runs, now);
  const problems: string[] = [];

  for (const provider of silentProviders) {
    problems.push(
      provider.lastSeen === undefined
        ? `${provider.providerId}: no rows at all, ever`
        : `${provider.providerId}: no rows for ${provider.hoursAgo.toFixed(1)}h (last ${provider.lastSeen})`,
    );
  }

  // Only escalated on duration, because a stale upstream and a caching adapter
  // of ours are indistinguishable from here. Saying which it is would be
  // asserting more than the data supports.
  if (reference.kind === 'stale_source' && reference.frozenHours >= STALE_REFERENCE_HOURS) {
    problems.push(
      `mid_market has been frozen at ${reference.value} since ${reference.since} ` +
        `(${reference.frozenHours.toFixed(1)}h) while the ingest kept running — ` +
        'too long to be an illiquid hour, whatever the cause',
    );
  }

  if (reference.kind === 'stuck') {
    problems.push(
      `mid_market has repeated the same timestamp AND value across ${reference.runs} runs ` +
        `(${reference.since}, ${reference.value}), and the runs do not show a healthy ` +
        'ingest behind it — that one is ours to answer for',
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

  // Two different problems, and they used to be indistinguishable. Neither is
  // "a fetch failed": one capture missing leaves the rate in force.
  if (trm.kind === 'expired') {
    problems.push(
      `the TRM we hold (${trm.value}, valid through ${trm.until}) expired ` +
        `${trm.hoursStale.toFixed(1)}h ago — we did not renew before it ran out`,
    );
  }

  if (trm.kind === 'absent') {
    problems.push(
      'no TRM at all in the runs we can see — not a stale rate, no rate. ' +
        'datos.gov.co is the one source with no fallback (plan.md §7)',
    );
  }

  return { silentProviders, reference, trm, gaps, problems };
}
