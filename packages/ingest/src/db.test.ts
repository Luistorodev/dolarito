/**
 * Tests for the persistence translation (T008).
 *
 * Only the pure half is covered here: turning a `Quote` into a row and a
 * `Reference` into fields on `runs`. That is where the errors that matter live
 * — a field dropped or an `undefined` turned into a zero is silent, and lands
 * in `quotes` looking like an observation.
 *
 * The PostgREST calls around them are not exercised; see CLAUDE.md for what is
 * still unverified against a real database.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Quote, Reference } from './contract.ts';
import { __testing } from './db.ts';

const { quoteToRow, referenceToRunFields } = __testing;

const okQuote: Quote = {
  provider_id: 'bitso',
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
  raw: { ticker: 'usdt_cop' },
  captured_at: '2026-09-13T17:00:00.000Z',
};

const outOfRangeQuote: Quote = {
  provider_id: 'eldorado',
  mode: 'local',
  asset: 'usdt',
  channel: 'p2p',
  direction: 'cop_to_usd',
  bracket_usd: 1,
  fixed_side: 'out',
  status: 'out_of_range',
  limit_reason: 'below_minimum',
  amounts_source: 'provider',
  raw: { minimum: 5 },
  captured_at: '2026-09-13T17:00:00.000Z',
};

describe('a quote becomes a row', () => {
  it('carries both amounts and their currencies when the quote is ok', () => {
    const row = quoteToRow('run-1', okQuote);

    assert.equal(row['run_id'], 'run-1');
    assert.equal(row['amount_in'], 100);
    assert.equal(row['currency_in'], 'USD');
    assert.equal(row['amount_out'], 308_000);
    assert.equal(row['currency_out'], 'COP');
    assert.equal(row['limit_reason'], null, 'an ok row has no limit to report');
  });

  it('turns every absent field into null, never into zero', () => {
    const row = quoteToRow('run-1', okQuote);

    // The quote states a rate and no fees at all. Art. I.1: a fee the source
    // did not state is unknown, not free.
    for (const field of ['fee_pct', 'fee_fixed_usd', 'fee_amount_usd', 'eta_minutes']) {
      assert.equal(row[field], null, `${field} must be null`);
      assert.notEqual(row[field], 0, `${field} must not be zero`);
    }
    assert.equal(row['payment_method'], null);
    assert.equal(row['gross_rate'], 3080, 'what the source DID state survives');
  });

  it('keeps an out_of_range row without amounts, but with its reason', () => {
    const row = quoteToRow('run-1', outOfRangeQuote);

    assert.equal(row['status'], 'out_of_range');
    assert.equal(row['limit_reason'], 'below_minimum');
    assert.equal(row['amount_in'], null);
    assert.equal(row['amount_out'], null);
    assert.equal(row['currency_in'], null);
    assert.equal(row['currency_out'], null);
  });

  it('writes every column the schema requires', () => {
    const row = quoteToRow('run-1', okQuote);

    // Each of these is NOT NULL or a CHECK in plan.md §2. A missing key here
    // is a run that fails at insert time, in production, at 15-minute
    // intervals.
    for (const column of [
      'run_id',
      'provider_id',
      'mode',
      'asset',
      'channel',
      'direction',
      'bracket_usd',
      'fixed_side',
      'status',
      'amounts_source',
      'raw',
      'captured_at',
    ]) {
      assert.ok(column in row, `${column} is missing from the row`);
      assert.notEqual(row[column], undefined, `${column} is undefined`);
    }
  });

  it('passes raw through untouched', () => {
    const row = quoteToRow('run-1', okQuote);
    assert.deepEqual(row['raw'], { ticker: 'usdt_cop' });
  });
});

describe('a reference becomes fields on the run', () => {
  it('maps TRM to its three columns, with the validity window', () => {
    const trm: Reference = {
      kind: 'trm',
      value: 4012.34,
      source: 'datos_gov',
      valid_from: '2026-09-12',
      valid_to: '2026-09-15',
      raw: {},
    };

    assert.deepEqual(referenceToRunFields(trm), {
      trm: 4012.34,
      trm_from: '2026-09-12',
      trm_to: '2026-09-15',
    });
  });

  it('maps the mid-market rate to its own three, recording which source answered', () => {
    const mid: Reference = {
      kind: 'mid_market',
      value: 3990.5,
      source: 'er_api',
      observed_at: '2026-09-13T16:00:00.000Z',
      raw: {},
    };

    assert.deepEqual(referenceToRunFields(mid), {
      mid_market: 3990.5,
      mid_market_src: 'er_api',
      mid_market_at: '2026-09-13T16:00:00.000Z',
    });
  });

  it('leaves an absent validity window null rather than guessing one', () => {
    const trm: Reference = { kind: 'trm', value: 4012.34, source: 'datos_gov', raw: {} };

    assert.deepEqual(referenceToRunFields(trm), {
      trm: 4012.34,
      trm_from: null,
      trm_to: null,
    });
  });

  it('does not write the other reference’s columns', () => {
    const trm: Reference = { kind: 'trm', value: 4012.34, source: 'datos_gov', raw: {} };
    const fields = referenceToRunFields(trm);

    // Both references write onto the same row. If TRM touched mid_market's
    // columns it would clobber whatever the other adapter had just resolved.
    assert.ok(!('mid_market' in fields));
    assert.ok(!('mid_market_src' in fields));
    assert.ok(!('mid_market_at' in fields));
  });
});

describe('which trigger opened the run', () => {
  // The field is only descriptive, so the rule is that a bad value must never
  // be able to take the ingest down (Art. II) — and that an absent value stays
  // absent rather than becoming a guess (Art. I.1).
  const { readTrigger } = __testing;

  it('accepts the four the column allows', () => {
    for (const t of ['github_schedule', 'pg_cron', 'manual', 'local']) {
      assert.equal(readTrigger(t), t);
    }
  });

  it('drops an unset variable, which is what makes this safe before the migration', () => {
    // With no variable set the insert is byte-for-byte today's, so this can
    // ship before the column exists.
    assert.equal(readTrigger(undefined), undefined);
    assert.equal(readTrigger(''), undefined);
  });

  it('drops a typo instead of failing the whole run', () => {
    // A misspelling in a workflow would otherwise be rejected by the check
    // constraint on every insert, taking the ingest down to mislabel a field
    // that only describes it.
    assert.equal(readTrigger('github-schedule'), undefined);
    assert.equal(readTrigger('GITHUB_SCHEDULE'), undefined);
    assert.equal(readTrigger('pg_cron '), undefined);
  });
});
