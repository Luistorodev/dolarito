/**
 * Tests for freshness (T026, HU-06, RF-11).
 *
 * The criterion is "forcing an old datum makes the mark appear". That alone
 * would pass against a page that marks everything stale whenever the ingest
 * stops — which is the mistake this module exists to avoid, and the same one
 * check:silence made on 2026-09-14 in a less visible form.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ageLabel,
  agesByProvider,
  describeFreshness,
  findMissing,
  type Sighted,
  STALE_MINUTES,
} from './freshness.ts';

const NOW = new Date('2026-09-15T15:00:00Z');
const ALL = ['bitso', 'buda', 'dolarapp', 'eldorado', 'binance_p2p', 'wise'];

function minutesAgo(minutes: number): string {
  return new Date(NOW.getTime() - minutes * 60_000).toISOString();
}

function rows(spec: Record<string, number>): Sighted[] {
  return Object.entries(spec).map(([provider_id, minutes]) => ({
    provider_id,
    captured_at: minutesAgo(minutes),
  }));
}

describe('the mark appears when a datum is old', () => {
  it('says nothing when everything is inside the window', () => {
    const freshness = describeFreshness(rows({ bitso: 3, buda: 5, wise: 10 }), NOW);
    assert.equal(freshness.kind, 'fresh');
  });

  it('marks the provider that fell behind while the others kept up', () => {
    const freshness = describeFreshness(rows({ bitso: 3, buda: 5, wise: 200 }), NOW);

    assert.equal(freshness.kind, 'some_stale');
    assert.ok(freshness.kind === 'some_stale');
    assert.deepEqual(
      freshness.stale.map((s) => s.providerId),
      ['wise'],
    );
  });

  it('does not mark a row that is exactly at the threshold', () => {
    // 60 minutes is "over 60", not "60 or more". A boundary that fires at the
    // limit makes the mark appear on a perfectly ordinary cycle.
    assert.equal(describeFreshness(rows({ bitso: STALE_MINUTES }), NOW).kind, 'fresh');
    assert.equal(describeFreshness(rows({ bitso: STALE_MINUTES + 1 }), NOW).kind, 'all_stale');
  });

  it('orders the stale ones worst first', () => {
    const freshness = describeFreshness(rows({ bitso: 3, buda: 300, wise: 90 }), NOW);
    assert.ok(freshness.kind === 'some_stale');
    assert.deepEqual(
      freshness.stale.map((s) => s.providerId),
      ['buda', 'wise'],
    );
  });
});

describe('everything old is OUR outage, not eight source failures', () => {
  // The distinction the whole module is for. Eight stale badges and one
  // "the capture stopped" describe the same pixels and lead to opposite
  // actions: chase eight providers, or look at the scheduler.

  it('calls it all_stale rather than listing every provider', () => {
    const freshness = describeFreshness(rows({ bitso: 200, buda: 210, wise: 205 }), NOW);

    assert.equal(freshness.kind, 'all_stale');
    assert.ok(freshness.kind === 'all_stale');
    assert.ok(freshness.newestMinutes > 190);
  });

  it('is NOT some_stale, however many providers are involved', () => {
    const many = Object.fromEntries(ALL.map((id) => [id, 400]));
    const freshness = describeFreshness(rows(many), NOW);

    assert.notEqual(freshness.kind, 'some_stale');
    assert.equal(freshness.kind, 'all_stale');
  });

  it('flips back the moment one provider is current again', () => {
    const recovering = describeFreshness(rows({ bitso: 2, buda: 400, wise: 400 }), NOW);
    assert.equal(recovering.kind, 'some_stale', 'the capture is running; those two lag');
  });

  it('has nothing to say about an empty page', () => {
    assert.equal(describeFreshness([], NOW).kind, 'nothing');
  });
});

describe('a provider with no row at all', () => {
  it('is found from the catalogue, because absence leaves nothing to find', () => {
    const present = rows({ bitso: 3, buda: 5 });
    assert.deepEqual(findMissing(ALL, present), ['dolarapp', 'eldorado', 'binance_p2p', 'wise']);
  });

  it('is not the same as being stale — a lagging provider still has a row', () => {
    const lagging = rows({ bitso: 3, buda: 500 });
    assert.deepEqual(findMissing(['bitso', 'buda'], lagging), []);
    assert.equal(describeFreshness(lagging, NOW).kind, 'some_stale');
  });

  it('reports none when everyone is present', () => {
    assert.deepEqual(findMissing(ALL, rows(Object.fromEntries(ALL.map((i) => [i, 5])))), []);
  });
});

describe('the ages themselves', () => {
  it('keeps the newest row per provider, not the first one seen', () => {
    const ages = agesByProvider(
      [
        { provider_id: 'bitso', captured_at: minutesAgo(300) },
        { provider_id: 'bitso', captured_at: minutesAgo(4) },
      ],
      NOW,
    );
    assert.ok((ages.get('bitso') ?? 0) < 5);
  });

  it('treats an unparseable date as infinitely old rather than as now', () => {
    // Zero would render as "recién" on a row whose capture time is unknown,
    // which is the most confident possible lie.
    const ages = agesByProvider([{ provider_id: 'x', captured_at: 'no es fecha' }], NOW);
    assert.equal(ages.get('x'), Number.POSITIVE_INFINITY);
  });

  it('reads in Spanish at the scales a reader cares about', () => {
    assert.equal(ageLabel(0.4), 'recién');
    assert.equal(ageLabel(7), 'hace 7 min');
    assert.equal(ageLabel(150), 'hace 3 h');
    assert.equal(ageLabel(60 * 40), 'hace 2 d');
    assert.equal(ageLabel(Number.POSITIVE_INFINITY), 'sin fecha');
  });
});
