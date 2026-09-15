/**
 * Tests for the provider profiles (T027).
 *
 * The point of the module is that nothing on a provider page is prose somebody
 * wrote: it is all computed from captured rows. So the tests check that the
 * computations say what the data says, including when the data says nothing.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { linkable, PROVIDERS } from './catalogue.ts';
import { buildProfile, observations, summarise } from './profile.ts';
import type { LatestQuote } from './quotes.ts';

function quote(overrides: Partial<LatestQuote>): LatestQuote {
  return {
    provider_id: 'bitso',
    mode: 'local',
    asset: 'usdt',
    channel: 'exchange',
    direction: 'usd_to_cop',
    bracket_usd: 100,
    payment_method: null,
    fixed_side: 'in',
    amount_in: 100,
    currency_in: 'USD',
    amount_out: 300_000,
    currency_out: 'COP',
    status: 'ok',
    limit_reason: null,
    gross_rate: 3000,
    effective_rate: 3000,
    fee_pct: null,
    fee_fixed_usd: null,
    fee_amount_usd: null,
    amounts_source: 'computed',
    eta_minutes: null,
    captured_at: '2026-09-15T12:00:00Z',
    trm: 3109.3,
    trm_from: '2026-09-15',
    trm_to: '2026-09-15',
    mid_market: 3105.99,
    mid_market_src: 'yahoo',
    mid_market_at: '2026-09-15T11:45:00Z',
    markup_vs_trm: 0.01,
    markup_vs_mid: 0.01,
    ...overrides,
  };
}

describe('a profile is computed, never asserted', () => {
  it('says nothing about a provider with no captured rows', () => {
    // Better than an empty page of confident headings over no data.
    assert.equal(buildProfile('bitso', []), undefined);
  });

  it('reads the characterisation off the row rather than off a list', () => {
    const profile = buildProfile('bitso', [quote({})]);
    assert.ok(profile !== undefined);
    assert.equal(summarise(profile), 'Local · exchange · cotiza en USDT');
  });

  it('collects the payment methods that actually quoted', () => {
    const profile = buildProfile('eldorado', [
      quote({ provider_id: 'eldorado', payment_method: 'app_nequi_co' }),
      quote({ provider_id: 'eldorado', payment_method: 'bank_bancolombia' }),
      quote({ provider_id: 'eldorado', payment_method: 'app_nequi_co', bracket_usd: 500 }),
    ]);
    assert.deepEqual(profile?.paymentMethods, ['app_nequi_co', 'bank_bancolombia']);
  });

  it('leaves the seven single-method providers with an empty list, not a fake one', () => {
    assert.deepEqual(buildProfile('bitso', [quote({})])?.paymentMethods, []);
  });
});

describe('whether the price moves with the amount', () => {
  it('sees a flat rate as flat', () => {
    const profile = buildProfile('bitso', [
      quote({ bracket_usd: 100, gross_rate: 3000 }),
      quote({ bracket_usd: 500, gross_rate: 3000 }),
    ]);
    assert.ok(profile !== undefined);
    assert.equal(profile.priceVariesByAmount, false);
    assert.ok(observations(profile).some((o) => o.includes('no cambia con el monto')));
  });

  it('sees a book-walked price as varying', () => {
    const profile = buildProfile('binance_p2p', [
      quote({ provider_id: 'binance_p2p', bracket_usd: 100, gross_rate: 3082 }),
      quote({ provider_id: 'binance_p2p', bracket_usd: 500, gross_rate: 3090 }),
    ]);
    assert.equal(profile?.priceVariesByAmount, true);
  });

  it('says nothing at all with a single bracket to look at', () => {
    // One observation is not a trend, and `undefined` here is the honest
    // answer rather than defaulting to "flat".
    const profile = buildProfile('bitso', [quote({})]);
    assert.ok(profile !== undefined);
    assert.equal(profile.priceVariesByAmount, undefined);
    assert.ok(!observations(profile).some((o) => o.includes('cambia con el monto')));
  });

  it('compares within one direction and one method, not across them', () => {
    // Eldorado's methods differ in price. Comparing across them would report
    // "varies by amount" for a provider whose rate is flat per method.
    const profile = buildProfile('eldorado', [
      quote({ provider_id: 'eldorado', payment_method: 'a', bracket_usd: 100, gross_rate: 3000 }),
      quote({ provider_id: 'eldorado', payment_method: 'a', bracket_usd: 500, gross_rate: 3000 }),
      quote({ provider_id: 'eldorado', payment_method: 'b', bracket_usd: 100, gross_rate: 3200 }),
    ]);
    assert.equal(profile?.priceVariesByAmount, false);
  });
});

describe('what the brackets did', () => {
  it('records a refusal with its reason', () => {
    const profile = buildProfile('binance_p2p', [
      quote({
        provider_id: 'binance_p2p',
        bracket_usd: 1,
        status: 'out_of_range',
        limit_reason: 'below_minimum',
      }),
      quote({ provider_id: 'binance_p2p', bracket_usd: 100 }),
    ]);

    assert.ok(profile !== undefined);
    assert.equal(profile.brackets.length, 2);
    assert.ok(observations(profile).some((o) => o.includes('No opera en 1 USD')));
  });

  it('notices a stated fee, and its absence', () => {
    assert.equal(buildProfile('bitso', [quote({})])?.statesAFee, false);
    assert.equal(
      buildProfile('wise', [quote({ provider_id: 'wise', fee_fixed_usd: 9.16 })])?.statesAFee,
      true,
    );
  });

  it('never says a fee is zero, only that none was stated', () => {
    // Art. I.1: unknown is not zero, and the wording has to keep that.
    const plain = buildProfile('bitso', [quote({})]);
    assert.ok(plain !== undefined);
    const said = observations(plain);
    assert.ok(said.some((o) => o.includes('No declara comisión aparte')));
    assert.ok(!said.some((o) => o.includes('sin comisión') || o.includes('gratis')));
  });
});

describe('site links, and which ones may be published', () => {
  // Checked against the network on 2026-09-15. Eight URLs written from general
  // knowledge, never reviewed, about to become links on a public page.

  it('withholds the one that resolves somewhere else', () => {
    const dolarapp = PROVIDERS.find((p) => p.id === 'dolarapp');
    assert.ok(dolarapp !== undefined);
    assert.equal(dolarapp.siteStatus, 'needs_review');
    assert.equal(linkable(dolarapp), false, 'must not be published as a link');
  });

  it('publishes the six that resolved to the right company', () => {
    const verified = PROVIDERS.filter((p) => p.siteStatus === 'verified');
    assert.equal(verified.length, 6);
    for (const provider of verified) assert.equal(linkable(provider), true);
  });

  it('publishes the blocked one but records that it proved nothing', () => {
    // A 403 from Cloudflare is not evidence the address is wrong, and Art. V.6
    // forbids working around a block to find out.
    const buda = PROVIDERS.find((p) => p.id === 'buda');
    assert.equal(buda?.siteStatus, 'unverified');
    assert.ok(buda?.siteNote?.includes('403'));
  });

  it('gives every provider a status, so none is published by omission', () => {
    for (const provider of PROVIDERS) {
      assert.ok(provider.site.startsWith('https://'), `${provider.id} has no site`);
      assert.ok(
        ['verified', 'unverified', 'needs_review'].includes(provider.siteStatus),
        `${provider.id} has no status`,
      );
    }
  });
});
