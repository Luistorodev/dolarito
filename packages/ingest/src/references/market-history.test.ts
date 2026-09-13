/**
 * Tests for the history seed parser (T011b).
 *
 * Against a real two-year pull saved on 2026-09-13, with no network
 * (Art. VII.3).
 *
 * The weekday distribution is the assertion that matters. Read naively as UTC,
 * this same series lands 31 Sundays in a single year — an error that is
 * invisible row by row and corrupts the whole baseline HU-08 rests on. The only
 * way to see it is in aggregate.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { type HistoryResponse, parseHistory, sessionDate } from './market-history.ts';

const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures');
const SERIES = JSON.parse(
  readFileSync(resolve(FIXTURES, 'market-history-yahoo-2y-2026-09-13.json'), 'utf8'),
) as HistoryResponse;

/** The day the fixture was captured, so "still open" is deterministic. */
const CAPTURED = new Date('2026-09-13T21:00:00.000Z');

function dayOfWeek(d: string): number {
  return new Date(`${d}T12:00:00Z`).getUTCDay();
}

describe('the session day comes from the exchange timezone', () => {
  it('moves a 23:00Z summer bar onto the next day', () => {
    // 2026-09-10T23:00Z is 00:00 BST on the 11th: the Friday session.
    assert.equal(sessionDate(Date.parse('2026-09-10T23:00:00Z') / 1000), '2026-09-11');
  });

  it('leaves a 00:00Z winter bar on its own day', () => {
    // In GMT the session starts at 00:00Z, so no shift is wanted. A fixed
    // +1h offset would also survive this; the timezone conversion is what
    // makes it correct rather than lucky.
    assert.equal(sessionDate(Date.parse('2026-01-15T00:00:00Z') / 1000), '2026-01-15');
  });
});

describe('the parsed series', () => {
  const { rows, skipped } = parseHistory(SERIES, CAPTURED);

  it('covers more than six months of daily closes', () => {
    assert.ok(rows.length >= 126, `${rows.length} rows`);

    const oldest = rows[0]?.d ?? '';
    const newest = rows[rows.length - 1]?.d ?? '';
    const months =
      (Date.parse(`${newest}T00:00:00Z`) - Date.parse(`${oldest}T00:00:00Z`)) / 86_400_000 / 30.44;
    assert.ok(months >= 6, `${months.toFixed(1)} months`);
  });

  it('lands on business days only — not one weekend row', () => {
    // The whole point. Naive UTC parsing puts 31 Sundays in a single year.
    const weekend = rows.filter((row) => dayOfWeek(row.d) === 0 || dayOfWeek(row.d) === 6);
    assert.deepEqual(weekend, []);
  });

  it('spreads evenly across Monday to Friday', () => {
    const counts = [1, 2, 3, 4, 5].map((day) => rows.filter((r) => dayOfWeek(r.d) === day).length);
    const min = Math.min(...counts);
    const max = Math.max(...counts);
    assert.ok(max - min <= 3, `uneven across weekdays: ${counts.join(', ')}`);
  });

  it('has one row per day, in order, with no duplicates', () => {
    const days = rows.map((row) => row.d);
    assert.deepEqual(days, [...days].sort(), 'ascending');
    assert.equal(new Set(days).size, days.length, 'no repeated day');
  });

  it('carries a usable close on every row', () => {
    assert.ok(rows.every((row) => Number.isFinite(row.close) && row.close > 0));
  });

  it('skips holidays instead of filling them', () => {
    // Yahoo returns null for a day the market did not trade. Art. I.4: the hole
    // stays a hole — not carried forward from the previous close.
    assert.ok(skipped.noClose > 0, 'the fixture does contain gaps');

    const gaps = rows.filter((row, index) => {
      if (index === 0) return false;
      const previous = rows[index - 1]?.d ?? row.d;
      const step =
        (Date.parse(`${row.d}T00:00:00Z`) - Date.parse(`${previous}T00:00:00Z`)) / 86_400_000;
      return step > 3;
    });
    assert.ok(gaps.length > 0, 'and they survive as gaps in the series');
  });

  it('leaves out the session still in progress', () => {
    assert.equal(skipped.notYetClosed, 1);
    const newest = rows[rows.length - 1]?.d ?? '';
    assert.ok(newest < '2026-09-13', `${newest} must predate the capture day`);
  });
});

describe('a series that cannot be read is a failure, not an empty seed', () => {
  it('throws when there is no series at all', () => {
    assert.throws(() => parseHistory({}), /no series/);
    assert.throws(() => parseHistory({ chart: { result: [] } }), /no series/);
  });

  it('throws when timestamps and closes do not line up', () => {
    const mismatched: HistoryResponse = {
      chart: {
        result: [{ timestamp: [1, 2, 3], indicators: { quote: [{ close: [1, 2] }] } }],
      },
    };
    assert.throws(() => parseHistory(mismatched), /3 timestamps against 2 closes/);
  });

  it('drops a zero or negative close rather than seeding it', () => {
    const odd: HistoryResponse = {
      chart: {
        result: [
          {
            timestamp: [Date.parse('2026-01-14T00:00:00Z') / 1000],
            indicators: { quote: [{ close: [0] }] },
          },
        ],
      },
    };
    const { rows, skipped } = parseHistory(odd, CAPTURED);
    assert.deepEqual(rows, []);
    assert.equal(skipped.noClose, 1);
  });
});
