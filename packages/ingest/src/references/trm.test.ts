/**
 * Tests for the TRM adapter (T010).
 *
 * Against real saved responses, with no network (Art. VII.3). The fixtures were
 * captured from the live endpoint on 2026-09-13.
 *
 * The weekend fixture is the one that matters. A weekday record has
 * `vigenciadesde === vigenciahasta`, so an adapter that assumed one record means
 * one day would pass every weekday test and be wrong every Saturday, Sunday and
 * public holiday. The one-day fixture is here as the contrast that makes the
 * three-day case mean something.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { HttpError, TEST_USER_AGENT } from '../http.ts';
import { createTrmAdapter, parseTrm, TRM_URL, type TrmRecord } from './trm.ts';

const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures');

function fixture(name: string): TrmRecord[] {
  return JSON.parse(readFileSync(resolve(FIXTURES, name), 'utf8')) as TrmRecord[];
}

const WEEKEND = fixture('trm-weekend-2026-09-12.json');
const WEEKDAY = fixture('trm-weekday-2026-09-11.json');

/** Replays a fixture and records the URL it was asked for. */
function stubFetch(body: unknown) {
  const calls: string[] = [];
  const impl = (async (url: string | URL | Request) => {
    calls.push(String(url));
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe('the weekend record, which is the case that can break', () => {
  it('reads a validity window of more than one day straight off the datum', () => {
    const reference = parseTrm(WEEKEND);

    assert.equal(reference.valid_from, '2026-09-12');
    assert.equal(reference.valid_to, '2026-09-14');
    assert.notEqual(
      reference.valid_from,
      reference.valid_to,
      'a weekend record spans days — this is the whole point of reading vigenciahasta',
    );
  });

  it('covers Saturday, Sunday and Monday — no calendar arithmetic anywhere', () => {
    const reference = parseTrm(WEEKEND);
    const from = Date.parse(`${reference.valid_from}T00:00:00Z`);
    const to = Date.parse(`${reference.valid_to}T00:00:00Z`);
    const days = (to - from) / 86_400_000 + 1;

    assert.equal(days, 3);
    // No list of Colombian public holidays exists in this codebase, and none
    // should: the source states how long its own number rules.
    assert.equal(new Date(from).getUTCDay(), 6, 'starts on a Saturday');
    assert.equal(new Date(to).getUTCDay(), 1, 'runs through a Monday');
  });

  it('parses the rate as a number, not a string', () => {
    const reference = parseTrm(WEEKEND);
    assert.equal(reference.value, 3072.27);
    assert.equal(typeof reference.value, 'number');
  });

  it('keeps the whole response in raw', () => {
    const reference = parseTrm(WEEKEND);
    assert.deepEqual(reference.raw, WEEKEND);
  });

  it('declares itself a TRM from datos.gov.co', () => {
    const reference = parseTrm(WEEKEND);
    assert.equal(reference.kind, 'trm');
    assert.equal(reference.source, 'datos_gov');
  });
});

describe('the weekday record, for contrast', () => {
  it('spans exactly one day', () => {
    const reference = parseTrm(WEEKDAY);

    assert.equal(reference.valid_from, '2026-09-11');
    assert.equal(reference.valid_to, '2026-09-11');
    assert.equal(reference.value, 3101);
  });
});

describe('a TRM that cannot be read is a failed source, not a zero', () => {
  it('throws on an empty response', () => {
    assert.throws(() => parseTrm([]), /returned no records/);
  });

  it('throws when a required field is missing', () => {
    assert.throws(
      () => parseTrm([{ valor: '3072.27', vigenciadesde: '2026-09-12T00:00:00.000' }]),
      /required field is missing/,
    );
  });

  it('throws rather than coerce an unreadable rate to zero', () => {
    const broken: TrmRecord[] = [
      {
        valor: 'n/d',
        vigenciadesde: '2026-09-12T00:00:00.000',
        vigenciahasta: '2026-09-14T00:00:00.000',
      },
    ];

    assert.throws(() => parseTrm(broken), /not a usable number/);
    // Art. I.1: the alternative would be Number('n/d') -> NaN, or a helpful 0,
    // landing on the run as if the peso were worth nothing.
  });

  it('throws on a zero or negative rate', () => {
    const zero: TrmRecord[] = [
      {
        valor: '0',
        vigenciadesde: '2026-09-12T00:00:00.000',
        vigenciahasta: '2026-09-14T00:00:00.000',
      },
    ];
    assert.throws(() => parseTrm(zero), /not a usable number/);
  });

  it('throws on an unreadable date', () => {
    const broken: TrmRecord[] = [
      { valor: '3072.27', vigenciadesde: 'ayer', vigenciahasta: '2026-09-14T00:00:00.000' },
    ];
    assert.throws(() => parseTrm(broken), /unreadable date/);
  });
});

describe('the adapter itself', () => {
  it('asks for one record, newest first, with the space encoded', () => {
    assert.match(TRM_URL, /\$limit=1/);
    assert.match(TRM_URL, /\$order=vigenciadesde%20DESC/);
    assert.ok(!TRM_URL.includes('vigenciadesde DESC'), 'a raw space breaks some clients');
  });

  it('resolves a Reference through the shared HTTP client', async () => {
    const { impl, calls } = stubFetch(WEEKEND);
    const adapter = createTrmAdapter({ fetchImpl: impl, userAgent: TEST_USER_AGENT });

    assert.equal(adapter.kind, 'reference');
    assert.equal(adapter.id, 'trm');

    const reference = await adapter.fetchReference();
    assert.equal(reference.value, 3072.27);
    assert.equal(reference.valid_to, '2026-09-14');
    assert.deepEqual(calls, [TRM_URL], 'one request, to the documented URL');
  });

  // Until 2026-09-15 this asserted only that *something* threw, which is the
  // defect this repo keeps writing down and kept writing anyway: a missing
  // variable, a bad key and a typo all throw too, and every one of them would
  // have passed a test whose name promises something much narrower. It was the
  // one negative assertion in the package carrying no matcher, and CI found it
  // by throwing a different error at it.
  it('propagates a transport failure instead of inventing a rate', async () => {
    const impl = (async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;

    const adapter = createTrmAdapter({
      fetchImpl: impl,
      userAgent: TEST_USER_AGENT,
      maxAttempts: 1,
      sleep: async () => {},
    });
    await assert.rejects(
      () => adapter.fetchReference(),
      (error: unknown) => {
        assert.ok(error instanceof HttpError, `expected an HttpError, got ${String(error)}`);
        assert.match(error.message, /network down/, 'the transport cause reaches the caller');
        assert.equal(error.status, undefined, 'a transport failure carries no HTTP status');
        return true;
      },
    );
  });
});
