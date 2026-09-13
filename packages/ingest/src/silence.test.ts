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
  findSilentProviders,
  inspectReference,
  type QuoteSighting,
  type RunSighting,
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
    assert.ok(report.problems.some((p) => p.includes('stuck ingest, not a closed market')));
  });
});
