/**
 * Freshness (T026, HU-06, RF-11).
 *
 * ## The distinction the silence alarm had to learn, applied to the interface
 *
 * "This datum is old" and "the capture did not run" are different questions,
 * and on 2026-09-14 the alarm answered the first while believing it had
 * answered the second. A page has the same trap, in a more visible form: if the
 * ingest stops, **every** row goes stale at once, and marking eight providers
 * as lagging would blame the sources for something that is ours.
 *
 * So the discriminator is whether anything is fresh:
 *
 * | What the rows look like | What it means | What to say |
 * |---|---|---|
 * | Newest capture is recent, all rows recent | healthy | nothing |
 * | Newest is recent, some rows old | those providers are lagging | mark those rows |
 * | **Every** row old, including the newest | **the capture stopped** | one notice, not eight |
 * | A provider has no row at all | it went mute | name it |
 *
 * The third row is the one worth the type. Eight stale marks and one "the
 * capture stopped" describe the same pixels and lead to opposite actions.
 *
 * ## Why absence needs a list from outside the data
 *
 * A provider with no rows cannot be found by looking at rows. The expected set
 * has to come from somewhere else — here, the display catalogue — for the same
 * reason `findSilentProviders` takes `expected` from the registry rather than
 * from the database.
 */

/** Over this, a row is shown as stale. From the task. */
export const STALE_MINUTES = 60;

export type ProviderAge = { providerId: string; minutes: number };

export type Freshness =
  /** Everything within the window. Say nothing; a badge on healthy data is noise. */
  | { kind: 'fresh'; newestMinutes: number }
  /** Some providers lag while others are current. Their rows carry the mark. */
  | { kind: 'some_stale'; newestMinutes: number; stale: ProviderAge[] }
  /**
   * Nothing is recent, including the newest row. That is the capture having
   * stopped, not every provider failing at once — one notice, not eight.
   */
  | { kind: 'all_stale'; newestMinutes: number }
  /** No rows at all. The page has nothing to be fresh or stale about. */
  | { kind: 'nothing' };

export type Sighted = { provider_id: string; captured_at: string };

export function minutesSince(captured: string, now: Date): number {
  const at = Date.parse(captured);
  return Number.isNaN(at) ? Number.POSITIVE_INFINITY : (now.getTime() - at) / 60_000;
}

/** The newest capture per provider. */
export function agesByProvider(rows: readonly Sighted[], now: Date): Map<string, number> {
  const newest = new Map<string, number>();
  for (const row of rows) {
    const age = minutesSince(row.captured_at, now);
    const current = newest.get(row.provider_id);
    if (current === undefined || age < current) newest.set(row.provider_id, age);
  }
  return newest;
}

export function describeFreshness(
  rows: readonly Sighted[],
  now: Date,
  threshold: number = STALE_MINUTES,
): Freshness {
  if (rows.length === 0) return { kind: 'nothing' };

  const ages = agesByProvider(rows, now);
  const newestMinutes = Math.min(...ages.values());

  // Nothing at all is recent. Blaming the providers here would be reading our
  // own outage as eight simultaneous source failures.
  if (newestMinutes > threshold) return { kind: 'all_stale', newestMinutes };

  const stale = [...ages.entries()]
    .filter(([, minutes]) => minutes > threshold)
    .map(([providerId, minutes]) => ({ providerId, minutes }))
    .sort((a, b) => b.minutes - a.minutes);

  return stale.length === 0
    ? { kind: 'fresh', newestMinutes }
    : { kind: 'some_stale', newestMinutes, stale };
}

/**
 * Providers that produced no row at all.
 *
 * Separate from staleness on purpose: a provider with a two-hour-old row is
 * lagging, one with no row is mute, and only the second means the interface has
 * nothing to show for it. `expected` must come from the catalogue — absence
 * cannot be found by looking at what is present.
 */
export function findMissing(expected: readonly string[], rows: readonly Sighted[]): string[] {
  const present = new Set(rows.map((row) => row.provider_id));
  return expected.filter((providerId) => !present.has(providerId));
}

/** "hace 3 minutos", "hace 2 horas". Spanish, because the interface is. */
export function ageLabel(minutes: number): string {
  if (!Number.isFinite(minutes)) return 'sin fecha';
  if (minutes < 1) return 'recién';
  if (minutes < 60) return `hace ${Math.round(minutes)} min`;
  const hours = minutes / 60;
  if (hours < 24) return `hace ${Math.round(hours)} h`;
  return `hace ${Math.round(hours / 24)} d`;
}
