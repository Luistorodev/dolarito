/**
 * Tests for the Wise comparison adapter (T017).
 *
 * Against real responses saved on 2026-09-13, with no network (Art. VII.3).
 *
 * The spread assertion of plan.md §3 rule 6 does not apply: remittances run in
 * one direction only, so there is no buy side to compare a sell side against.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  buildQuotes,
  createWiseAdapter,
  durationToMinutes,
  WISE_PROVIDERS,
  type WiseResponse,
} from './wise.ts';

const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures');

function fixture(bracket: number): WiseResponse {
  return JSON.parse(
    readFileSync(resolve(FIXTURES, `wise-usd-cop-${bracket}-2026-09-13.json`), 'utf8'),
  ) as WiseResponse;
}

const CAPTURED = '2026-09-13T22:00:00.000Z';

describe('one call, three providers', () => {
  it('turns the bracket 100 response into three rows', () => {
    const rows = buildQuotes(fixture(100), 100, CAPTURED);

    assert.equal(rows.length, 3);
    assert.deepEqual(rows.map((r) => r.provider_id).sort(), ['instarem', 'western_union', 'wise']);
  });

  it('maps their alias onto our catalogue id', () => {
    assert.equal(WISE_PROVIDERS['western-union'], 'western_union', 'hyphen to underscore');
    assert.equal(WISE_PROVIDERS['wise'], 'wise');
    assert.equal(WISE_PROVIDERS['instarem'], 'instarem');
  });

  it('every row is a remittance in one direction', () => {
    for (const row of buildQuotes(fixture(500), 500, CAPTURED)) {
      assert.equal(row.mode, 'remesa');
      assert.equal(row.asset, 'usd');
      assert.equal(row.channel, 'bank_transfer');
      assert.equal(row.direction, 'usd_to_cop');
      assert.equal(row.fixed_side, 'in', 'a remittance fixes what you send');
      assert.equal(row.amounts_source, 'provider');
    }
  });

  it('ignores a provider that is not one of ours', () => {
    const stranger: WiseResponse = {
      providers: [
        { alias: 'some-other-bank', quotes: [{ rate: 3000, receivedAmount: 300_000, fee: 1 }] },
        ...(fixture(100).providers ?? []),
      ],
    };
    assert.equal(buildQuotes(stranger, 100, CAPTURED).length, 3);
  });
});

describe('the amounts are the provider’s own', () => {
  it('records receivedAmount without recomputing it', () => {
    const rows = buildQuotes(fixture(100), 100, CAPTURED);
    const wise = rows.find((r) => r.provider_id === 'wise');
    const instarem = rows.find((r) => r.provider_id === 'instarem');

    assert.ok(wise?.status === 'ok' && instarem?.status === 'ok');
    assert.deepEqual(wise.out, { amount: 280_357.68, currency: 'COP' });
    assert.deepEqual(instarem.out, { amount: 306_325.54, currency: 'COP' });

    // Not rate x bracket: the fee is already inside receivedAmount, so
    // recomputing would double-count it.
    assert.notEqual(wise.out.amount, (wise.gross_rate ?? 0) * 100);
  });

  it('fixes the input at the bracket in USD', () => {
    for (const bracket of [100, 500, 1000] as const) {
      for (const row of buildQuotes(fixture(bracket), bracket, CAPTURED)) {
        assert.ok(row.status === 'ok');
        assert.deepEqual(row.in, { amount: bracket, currency: 'USD' });
        assert.equal(row.out.currency, 'COP');
      }
    }
  });

  it('maps fee to fee_fixed_usd, absolute in dollars', () => {
    const rows = buildQuotes(fixture(100), 100, CAPTURED);

    assert.equal(rows.find((r) => r.provider_id === 'wise')?.fee_fixed_usd, 9.16);
    assert.equal(rows.find((r) => r.provider_id === 'western_union')?.fee_fixed_usd, 1.99);
    assert.equal(
      rows.find((r) => r.provider_id === 'instarem')?.fee_fixed_usd,
      0,
      'a stated zero is a real zero, unlike an absent field',
    );
  });

  it('leaves fee_pct undefined — this endpoint states no percentage', () => {
    for (const row of buildQuotes(fixture(100), 100, CAPTURED)) {
      assert.equal(row.fee_pct, undefined);
      assert.equal(row.fee_amount_usd, undefined);
    }
  });
});

describe('a provider missing from the response gets no row', () => {
  it('bracket 1 yields one row, not three', () => {
    // Verified on the live endpoint and consistent across calls: only Instarem
    // comes back at 1 USD.
    const rows = buildQuotes(fixture(1), 1, CAPTURED);

    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.provider_id, 'instarem');
  });

  it('writes nothing at all for the absent ones — not below_minimum', () => {
    // The response never says why anyone is absent. Marking it below_minimum
    // would state a cause the source did not give (Art. I.1), and this endpoint
    // is a periodic harvest rather than a live quote, so an absence can equally
    // be an uncovered corridor or an incomplete collection pass.
    const rows = buildQuotes(fixture(1), 1, CAPTURED);
    const ids = rows.map((r) => r.provider_id);

    assert.ok(!ids.includes('wise'));
    assert.ok(!ids.includes('western_union'));
    assert.ok(
      rows.every((r) => r.status === 'ok'),
      'no invented out_of_range row',
    );
  });

  it('skips a provider whose quote cannot be read', () => {
    const broken: WiseResponse = {
      providers: [
        { alias: 'wise', quotes: [{ rate: 0, receivedAmount: 100 }] },
        { alias: 'instarem', quotes: [{ rate: 3063, receivedAmount: 306_325.54, fee: 0 }] },
      ],
    };
    const rows = buildQuotes(broken, 100, CAPTURED);
    assert.deepEqual(
      rows.map((r) => r.provider_id),
      ['instarem'],
    );
  });

  it('throws when the response has no provider list at all', () => {
    assert.throws(() => buildQuotes({}, 100, CAPTURED), /no provider list/);
  });
});

describe('delivery estimation', () => {
  it('turns PT24H into 1440 minutes', () => {
    assert.equal(durationToMinutes('PT24H'), 1440);
    assert.equal(durationToMinutes('PT30M'), 30);
    assert.equal(durationToMinutes('PT1H30M'), 90);
  });

  it('returns undefined rather than guessing', () => {
    assert.equal(durationToMinutes(undefined), undefined);
    assert.equal(durationToMinutes('P2D'), undefined, 'a shape this endpoint does not send');
    assert.equal(durationToMinutes('PT0H'), undefined);
  });

  it('records eta_minutes only for the provider that gives one', () => {
    const rows = buildQuotes(fixture(100), 100, CAPTURED);

    // On this capture only Wise states a duration; the other two send null.
    assert.equal(rows.find((r) => r.provider_id === 'wise')?.eta_minutes, 1440);
    assert.equal(rows.find((r) => r.provider_id === 'instarem')?.eta_minutes, undefined);
    assert.equal(rows.find((r) => r.provider_id === 'western_union')?.eta_minutes, undefined);
  });
});

describe('the adapter', () => {
  function stub() {
    const calls: string[] = [];
    const impl = (async (url: string | URL | Request) => {
      const text = String(url);
      calls.push(text);
      const amount = Number(new URL(text).searchParams.get('sendAmount'));
      return new Response(JSON.stringify(fixture(amount)), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;
    return { impl, calls };
  }

  it('declares the three providers it covers — the reason N2 exists', () => {
    const adapter = createWiseAdapter();
    assert.equal(adapter.id, 'wise');
    assert.equal(adapter.mode, 'remesa');
    assert.deepEqual(adapter.providerIds, ['wise', 'instarem', 'western_union']);
    assert.equal(adapter.providerIds.length, 3, 'one adapter, three names in the ranking');
  });

  it('makes one call per bracket and returns up to twelve rows', async () => {
    const { impl, calls } = stub();
    const rows = await createWiseAdapter({ fetchImpl: impl, now: () => CAPTURED }).fetchQuotes([
      1, 100, 500, 1000,
    ]);

    assert.equal(calls.length, 4, 'one call per bracket, three providers each');
    // Ten, not twelve: bracket 1 returned a single provider.
    assert.equal(rows.length, 10);
    assert.equal(rows.filter((r) => r.bracket_usd === 1).length, 1);
    assert.equal(rows.filter((r) => r.bracket_usd === 100).length, 3);
  });

  it('sends the bracket as sendAmount', async () => {
    const { impl, calls } = stub();
    await createWiseAdapter({ fetchImpl: impl, now: () => CAPTURED }).fetchQuotes([500]);
    assert.match(calls[0] ?? '', /sendAmount=500/);
    assert.match(calls[0] ?? '', /sourceCurrency=USD&targetCurrency=COP/);
  });
});
