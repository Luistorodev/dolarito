/**
 * Tests for the silence alarm (T019).
 *
 * The done criterion asks for two things, and the second is the one that took
 * a measurement to get right: it must fail on a mute source, and it must tell a
 * stuck ingest apart from a weekend with the market closed **without flagging
 * the second**.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildReport,
  collectSightings,
  findGaps,
  findSilentProviders,
  inspectReference,
  type QuoteSighting,
  type RunSighting,
  STALE_REFERENCE_HOURS,
} from './silence.ts';

const NOW = new Date('2026-09-14T12:00:00.000Z');
const ALL = [
  'bitso',
  'buda',
  'dolarapp',
  'eldorado',
  'binance_p2p',
  'wise',
  'instarem',
  'western_union',
];

function hoursAgo(h: number): string {
  return new Date(NOW.getTime() - h * 3_600_000).toISOString();
}

function seen(providers: readonly string[], h: number): QuoteSighting[] {
  return providers.map((provider_id) => ({ provider_id, captured_at: hoursAgo(h) }));
}

describe('a provider with no rows', () => {
  it('says nothing when every provider reported recently', () => {
    assert.deepEqual(findSilentProviders(ALL, seen(ALL, 0.25), NOW), []);
  });

  it('flags the one that went quiet — the deliberate failure the task asks for', () => {
    const sightings = [
      ...seen(
        ALL.filter((p) => p !== 'buda'),
        0.25,
      ),
      ...seen(['buda'], 9),
    ];
    const silent = findSilentProviders(ALL, sightings, NOW);

    assert.equal(silent.length, 1);
    assert.equal(silent[0]?.providerId, 'buda');
    assert.ok((silent[0]?.hoursAgo ?? 0) > 6);
  });

  it('does not flag one that is quiet but still inside the window', () => {
    const sightings = [
      ...seen(
        ALL.filter((p) => p !== 'buda'),
        0.25,
      ),
      ...seen(['buda'], 5.5),
    ];
    assert.deepEqual(findSilentProviders(ALL, sightings, NOW), []);
  });

  it('flags a provider that has never produced a single row', () => {
    // The worst case, not an edge case: expected comes from the registry, so a
    // provider that never worked at all cannot hide by being absent from the
    // data entirely.
    const silent = findSilentProviders(
      ALL,
      seen(
        ALL.filter((p) => p !== 'instarem'),
        0.25,
      ),
      NOW,
    );

    assert.equal(silent.length, 1);
    assert.equal(silent[0]?.providerId, 'instarem');
    assert.equal(silent[0]?.lastSeen, undefined);
    assert.equal(silent[0]?.hoursAgo, Number.POSITIVE_INFINITY);
  });
});

describe('a stuck ingest against a closed market', () => {
  // The distinction that a single run cannot make. Measured in T011: with the
  // FX market shut, Yahoo still returns a datum stamped minutes before the
  // capture, so "the datum is old" fires for neither case.

  it('calls it stuck when the timestamp AND the value repeat', () => {
    const runs: RunSighting[] = [
      { started_at: hoursAgo(0), mid_market: 3079.23, mid_market_at: '2026-09-13T20:00:00.000Z' },
      {
        started_at: hoursAgo(0.25),
        mid_market: 3079.23,
        mid_market_at: '2026-09-13T20:00:00.000Z',
      },
      { started_at: hoursAgo(0.5), mid_market: 3079.23, mid_market_at: '2026-09-13T20:00:00.000Z' },
    ];

    const verdict = inspectReference(runs);
    assert.equal(verdict.kind, 'stuck');
    assert.ok(verdict.kind === 'stuck');
    assert.equal(verdict.runs, 3);
    assert.equal(verdict.value, 3079.23);
  });

  it('does NOT flag a closed market — the timestamp moves, the price does not', () => {
    // This is the case that must stay quiet. A whole weekend produces it
    // legitimately, and Art. I.4 requires leaving the value still rather than
    // interpolating over it.
    const runs: RunSighting[] = [
      { started_at: hoursAgo(0), mid_market: 3079.23, mid_market_at: '2026-09-14T11:45:00.000Z' },
      {
        started_at: hoursAgo(0.25),
        mid_market: 3079.23,
        mid_market_at: '2026-09-14T11:30:00.000Z',
      },
      { started_at: hoursAgo(0.5), mid_market: 3079.23, mid_market_at: '2026-09-14T11:15:00.000Z' },
    ];

    const verdict = inspectReference(runs);
    assert.equal(verdict.kind, 'market_closed');
    assert.notEqual(verdict.kind, 'stuck', 'a still price is not an incident');
  });

  it('calls an open market healthy', () => {
    const runs: RunSighting[] = [
      { started_at: hoursAgo(0), mid_market: 3081.5, mid_market_at: '2026-09-14T11:45:00.000Z' },
      { started_at: hoursAgo(0.25), mid_market: 3080.1, mid_market_at: '2026-09-14T11:30:00.000Z' },
      { started_at: hoursAgo(0.5), mid_market: 3079.23, mid_market_at: '2026-09-14T11:15:00.000Z' },
    ];

    assert.equal(inspectReference(runs).kind, 'healthy');
  });

  it('the value alone decides nothing — only the timestamp separates the two', () => {
    // Same still price in both cases; only mid_market_at differs, and that is
    // what flips the verdict.
    const still = { mid_market: 3079.23 };
    const stuck = inspectReference([
      { started_at: hoursAgo(0), ...still, mid_market_at: '2026-09-13T20:00:00.000Z' },
      { started_at: hoursAgo(0.25), ...still, mid_market_at: '2026-09-13T20:00:00.000Z' },
      { started_at: hoursAgo(0.5), ...still, mid_market_at: '2026-09-13T20:00:00.000Z' },
    ]);
    const closed = inspectReference([
      { started_at: hoursAgo(0), ...still, mid_market_at: '2026-09-14T11:45:00.000Z' },
      { started_at: hoursAgo(0.25), ...still, mid_market_at: '2026-09-14T11:30:00.000Z' },
      { started_at: hoursAgo(0.5), ...still, mid_market_at: '2026-09-14T11:15:00.000Z' },
    ]);

    assert.equal(stuck.kind, 'stuck');
    assert.equal(closed.kind, 'market_closed');
  });

  it('says nothing at all when there are too few runs to compare', () => {
    // A fresh database must not raise an incident on its second cycle.
    const runs: RunSighting[] = [
      { started_at: hoursAgo(0), mid_market: 3079.23, mid_market_at: '2026-09-14T11:45:00.000Z' },
    ];
    assert.equal(inspectReference(runs).kind, 'not_enough_runs');
  });

  it('ignores runs where the reference failed entirely', () => {
    const runs: RunSighting[] = [
      { started_at: hoursAgo(0), mid_market: null, mid_market_at: null },
      {
        started_at: hoursAgo(0.25),
        mid_market: 3079.23,
        mid_market_at: '2026-09-13T20:00:00.000Z',
      },
      { started_at: hoursAgo(0.5), mid_market: 3079.23, mid_market_at: '2026-09-13T20:00:00.000Z' },
    ];
    // Two usable runs is below the threshold, so no verdict is reached — a
    // failed reference is the orchestrator's incident, not this one's.
    assert.equal(inspectReference(runs).kind, 'not_enough_runs');
  });
});

describe('the report', () => {
  it('is empty when everything is healthy', () => {
    const runs: RunSighting[] = [
      { started_at: hoursAgo(0), mid_market: 3081.5, mid_market_at: '2026-09-14T11:45:00.000Z' },
      { started_at: hoursAgo(0.25), mid_market: 3080.1, mid_market_at: '2026-09-14T11:30:00.000Z' },
      { started_at: hoursAgo(0.5), mid_market: 3079.23, mid_market_at: '2026-09-14T11:15:00.000Z' },
    ];
    assert.deepEqual(buildReport(ALL, seen(ALL, 0.25), runs, NOW).problems, []);
  });

  it('stays empty through a closed market', () => {
    const runs: RunSighting[] = [
      { started_at: hoursAgo(0), mid_market: 3079.23, mid_market_at: '2026-09-14T11:45:00.000Z' },
      {
        started_at: hoursAgo(0.25),
        mid_market: 3079.23,
        mid_market_at: '2026-09-14T11:30:00.000Z',
      },
      { started_at: hoursAgo(0.5), mid_market: 3079.23, mid_market_at: '2026-09-14T11:15:00.000Z' },
    ];
    const report = buildReport(ALL, seen(ALL, 0.25), runs, NOW);

    assert.deepEqual(report.problems, [], 'a weekend must not page anyone');
    assert.equal(report.reference.kind, 'market_closed');
  });

  it('names both kinds of problem when both are present', () => {
    const runs: RunSighting[] = [
      { started_at: hoursAgo(0), mid_market: 3079.23, mid_market_at: '2026-09-13T20:00:00.000Z' },
      {
        started_at: hoursAgo(0.25),
        mid_market: 3079.23,
        mid_market_at: '2026-09-13T20:00:00.000Z',
      },
      { started_at: hoursAgo(0.5), mid_market: 3079.23, mid_market_at: '2026-09-13T20:00:00.000Z' },
    ];
    const sightings = [
      ...seen(
        ALL.filter((p) => p !== 'wise'),
        0.25,
      ),
      ...seen(['wise'], 20),
    ];

    const report = buildReport(ALL, sightings, runs, NOW);

    assert.equal(report.problems.length, 2);
    assert.ok(report.problems.some((p) => p.startsWith('wise:')));
    assert.ok(report.problems.some((p) => p.includes('ours to answer for')));
  });
});

describe('the ingest not running at all', () => {
  // Added 2026-09-14, after this suite passed green through a real outage.
  //
  // Checks 1 and 2 both ask "is the newest datum recent enough?", and neither
  // can see a hole that has already closed. Measured against the real data: at
  // the worst instant of the 81-minute hole, 0 of 8 providers read as silent.

  function runsAt(hoursAgoList: number[]): RunSighting[] {
    return hoursAgoList.map((h) => ({
      started_at: hoursAgo(h),
      mid_market: 3079.23 + h,
      mid_market_at: hoursAgo(h),
    }));
  }

  it('says nothing when the cadence is kept', () => {
    // Every 15 minutes for two hours.
    const runs = runsAt(Array.from({ length: 8 }, (_, i) => i * 0.25));
    assert.deepEqual(findGaps(runs, NOW), []);
  });

  it('tolerates a missed cycle or two, because Actions drops them under load', () => {
    // 30 and 45 minute holes. GitHub documents that it does not guarantee the
    // interval; alarming here would train everyone to ignore this.
    const runs = runsAt([0, 0.5, 1.25, 1.5]);
    assert.deepEqual(findGaps(runs, NOW), []);
  });

  it('reports a hole in the middle even though every provider looks fresh', () => {
    // THE false green, reproduced. A 3-hour hole, then a run that lands just
    // before the check — the shape a manual run after an outage produces.
    const runs = runsAt([0.1, 3.2, 3.4, 3.6]);
    const gaps = findGaps(runs, NOW);

    assert.equal(gaps.length, 1);
    assert.ok(gaps[0] !== undefined);
    assert.ok(Math.abs(gaps[0].minutes - 186) < 1, `got ${gaps[0].minutes}`);
    assert.equal(gaps[0].missedCycles, 11);

    // And the point of the test: the providers are NOT silent by the old check.
    assert.deepEqual(findSilentProviders(ALL, seen(ALL, 0.1), NOW), []);
  });

  it('reports the open hole — the ingest being down RIGHT NOW', () => {
    // The only way to notice an outage while it is still happening.
    const gaps = findGaps(runsAt([2.7, 2.95, 3.2]), NOW);

    assert.equal(gaps.length, 1);
    assert.equal(gaps[0]?.to, NOW.toISOString());
    assert.ok((gaps[0]?.minutes ?? 0) > 160);
  });

  it('measures the open hole against the last run even if it is ancient', () => {
    // The longest outages must not be the quietest ones.
    const gaps = findGaps(runsAt([72]), NOW);
    assert.equal(gaps.length, 1);
    assert.ok((gaps[0]?.minutes ?? 0) > 4300);
  });

  it('finds nothing in an empty database — that case is loud elsewhere', () => {
    // Every provider reads as "no rows at all, ever"; a gap would be noise.
    assert.deepEqual(findGaps([], NOW), []);
  });

  it('does not care what order the runs arrive in', () => {
    const ordered = runsAt([0.1, 3.2, 3.4, 3.6]);
    const shuffled = [ordered[2], ordered[0], ordered[3], ordered[1]] as RunSighting[];
    assert.deepEqual(findGaps(shuffled, NOW), findGaps(ordered, NOW));
  });

  it('the report now fails on the run history that used to pass clean', () => {
    // The regression test proper: same inputs that produced zero problems
    // before, against buildReport.
    const runs = runsAt([0.1, 3.2, 3.4, 3.6]);
    const report = buildReport(ALL, seen(ALL, 0.1), runs, NOW);

    assert.equal(report.silentProviders.length, 0, 'no provider is mute');
    assert.equal(report.reference.kind, 'healthy', 'the reference is fine');
    assert.equal(report.gaps.length, 1);
    assert.equal(report.problems.length, 1, 'and yet the run history is not fine');
    assert.ok(report.problems[0]?.includes('no run between'));
  });

  it('sees a hole that straddles the window edge, given the run that opens it', () => {
    // The blind spot found on 2026-09-14. The check queries a 6-hour window;
    // a hole that starts before it and ends inside it is only visible if the
    // run that OPENS the hole comes along too. check-silence.ts fetches one
    // run from beyond the edge for exactly this.
    const openedBefore = runsAt([9, 0.5]); // 8.5h apart, edge run + one inside

    const withEdge = findGaps(openedBefore, NOW);
    assert.equal(withEdge.length, 1, 'the straddling hole is reported');
    assert.ok(Math.abs((withEdge[0]?.minutes ?? 0) - 510) < 1);

    // And the proof that the edge run is what makes it visible: drop it and
    // the hole vanishes, leaving only whatever the trailing gap says.
    const withoutEdge = findGaps(runsAt([0.5]), NOW);
    assert.deepEqual(withoutEdge, [], 'a lone run inside the window sees nothing');
  });

  it('names an ongoing outage as ongoing, not as history', () => {
    const report = buildReport(ALL, seen(ALL, 0.1), runsAt([2.7, 2.95, 3.2]), NOW);
    assert.ok(report.problems.some((p) => p.includes('it is down right now')));
  });
});

describe('the window outgrowing a single query', () => {
  // The false RED of 2026-09-15, and the reason it could not have been caught
  // earlier: when the bulk query was written the window held a few hundred
  // rows, so there was nothing to truncate. The bug was not invisible, it was
  // UNREACHABLE — and it arrived the day the ingest started working properly.

  const ALL8 = [
    'bitso',
    'buda',
    'dolarapp',
    'eldorado',
    'binance_p2p',
    'wise',
    'instarem',
    'western_union',
  ];
  /** PostgREST's default ceiling. */
  const POSTGREST_CAP = 1000;

  /** A realistic window: 26 runs x 74 rows, every provider present throughout. */
  function fullWindow(): QuoteSighting[] {
    const rows: QuoteSighting[] = [];
    for (let run = 0; run < 26; run += 1) {
      const captured = new Date(NOW.getTime() - run * 15 * 60_000).toISOString();
      for (const provider of ALL8) {
        // Roughly the real shape: eldorado writes 32 a run, wise's three write 4 each.
        const perRun = provider === 'eldorado' ? 32 : provider === 'bitso' ? 8 : 4;
        for (let i = 0; i < perRun; i += 1)
          rows.push({ provider_id: provider, captured_at: captured });
      }
    }
    return rows;
  }

  it('a capped bulk read reports providers silent that wrote seconds ago', () => {
    const all = fullWindow();
    assert.ok(all.length > POSTGREST_CAP, `the window must exceed the cap, got ${all.length}`);

    // The cap keeps an arbitrary slice. Ordered by provider, the tail it drops
    // is entirely the last names — which is exactly what happened: all of
    // wise, instarem and western_union vanished.
    const truncated = [...all]
      .sort((a, b) => a.provider_id.localeCompare(b.provider_id))
      .slice(0, POSTGREST_CAP);

    const wronglySilent = findSilentProviders(ALL8, truncated, NOW);

    assert.ok(wronglySilent.length > 0, 'this is the false red, and it must reproduce');
    assert.ok(
      wronglySilent.some((p) => p.providerId === 'wise'),
      'wise is one of the providers the cap dropped',
    );
    // And the damning part: the alarm says "ever" about a provider whose rows
    // are right there in the full set.
    assert.equal(wronglySilent.find((p) => p.providerId === 'wise')?.lastSeen, undefined);
    assert.ok(all.some((r) => r.provider_id === 'wise'));
  });

  it('asking per provider is exact no matter how big the window gets', async () => {
    const all = fullWindow();
    const asked: string[] = [];

    const sightings = await collectSightings(ALL8, async (providerId) => {
      asked.push(providerId);
      const mine = all.filter((r) => r.provider_id === providerId);
      return mine
        .map((r) => r.captured_at)
        .sort()
        .at(-1);
    });

    assert.deepEqual(asked, ALL8, 'one query per provider, no bulk read');
    assert.equal(sightings.length, 8);
    assert.deepEqual(findSilentProviders(ALL8, sightings, NOW), [], 'nobody is silent, correctly');
  });

  it('still reports a provider that genuinely has nothing', async () => {
    // The fix must not buy its accuracy by going quiet.
    const sightings = await collectSightings(ALL8, async (providerId) =>
      providerId === 'buda' ? undefined : hoursAgo(0.25),
    );
    const silent = findSilentProviders(ALL8, sightings, NOW);

    assert.equal(silent.length, 1);
    assert.equal(silent[0]?.providerId, 'buda');
    assert.equal(silent[0]?.lastSeen, undefined);
  });
});

describe('a stale upstream against something of ours', () => {
  // The over-confident verdict of 2026-09-15: it announced "that is a stuck
  // ingest, not a closed market" while 26 runs in six hours were landing with
  // eight of eight sources answering. What was frozen was Yahoo, at an hour
  // with no liquidity, and recording a still rate is correct (Art. I.4).

  function frozen(sourcesOk: string[] | undefined, hoursFrozen = 2): RunSighting[] {
    const at = new Date(NOW.getTime() - hoursFrozen * 3_600_000).toISOString();
    return [0, 0.25, 0.5].map((h) => ({
      started_at: hoursAgo(h),
      mid_market: 3105.99,
      mid_market_at: at,
      ...(sourcesOk === undefined ? {} : { sources_ok: sourcesOk }),
    }));
  }

  const EIGHT = [
    'trm',
    'mid_market',
    'bitso',
    'buda',
    'dolarapp',
    'eldorado',
    'binance_p2p',
    'wise',
  ];

  it('calls it a stale source when our ingest is demonstrably alive', () => {
    const verdict = inspectReference(frozen(EIGHT), NOW);

    assert.equal(verdict.kind, 'stale_source');
    assert.ok(verdict.kind === 'stale_source');
    assert.ok(Math.abs(verdict.frozenHours - 2) < 0.1);
  });

  it('does NOT make a short freeze an incident', () => {
    // Two hours frozen overnight is ordinary. Paging for it teaches everyone
    // to ignore the alarm.
    const report = buildReport(ALL, seen(ALL, 0.25), frozen(EIGHT), NOW);
    assert.deepEqual(report.problems, []);
    assert.equal(report.reference.kind, 'stale_source');
  });

  it('escalates on duration, without claiming to know the cause', () => {
    // A stale upstream and a caching adapter of ours look identical from here.
    // After long enough it stops mattering which: somebody has to look.
    const report = buildReport(ALL, seen(ALL, 0.25), frozen(EIGHT, STALE_REFERENCE_HOURS + 1), NOW);

    assert.equal(report.problems.length, 1);
    assert.ok(report.problems[0]?.includes('whatever the cause'));
    assert.ok(!report.problems[0]?.includes('stuck ingest'), 'it must not assert a cause');
  });

  it('errs LOUD when it cannot show the ingest was healthy', () => {
    // No sources_ok means no evidence of our own health. An unknown makes this
    // louder, not quieter.
    assert.equal(inspectReference(frozen(undefined), NOW).kind, 'stuck');
  });

  it('errs loud when a source stopped answering behind the frozen datum', () => {
    assert.equal(inspectReference(frozen([]), NOW).kind, 'stuck');
  });
});
