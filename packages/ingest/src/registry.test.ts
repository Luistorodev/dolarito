/**
 * Tests for the adapter registry (T009).
 *
 * The done criterion is structural — "the orchestrator imports no adapter
 * directly" — so one test reads the source and checks it, rather than asserting
 * something that happens to be true today and would quietly stop being true the
 * first time someone reaches for a concrete adapter.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createFakeQuoteAdapter, createFakeReferenceAdapter } from './adapters/fake.ts';
import { PROVIDERS } from './lib/providers.ts';
import {
  ADAPTERS,
  assertRegistryIsCoherent,
  inspectRegistry,
  quoteAdapters,
  referenceAdapters,
} from './registry.ts';

const SRC = dirname(fileURLToPath(import.meta.url));

describe('the orchestration path imports no adapter', () => {
  it('orchestrator.ts reaches for no concrete adapter', () => {
    const source = readFileSync(resolve(SRC, 'orchestrator.ts'), 'utf8');

    const adapterImports = [...source.matchAll(/^import[^;]*from\s+'([^']+)';/gm)]
      .map((match) => match[1] ?? '')
      .filter((specifier) => specifier.includes('adapters/') || specifier.includes('registry'));

    assert.deepEqual(
      adapterImports,
      [],
      `the orchestrator must receive adapters, not reach for them — found: ${adapterImports.join(', ')}`,
    );
  });

  it('the registry is what knows about adapters', () => {
    const source = readFileSync(resolve(SRC, 'registry.ts'), 'utf8');
    assert.ok(source.includes('export const ADAPTERS'), 'the registry exports the array');
  });
});

describe('the registry today', () => {
  it('is empty, and honestly so', () => {
    // Every real adapter is still ahead. This assertion is meant to be edited
    // as T010 to T017 land, which is the point: adding a source is one line
    // there and one number here.
    assert.equal(ADAPTERS.length, 0);
  });

  it('contains no fake adapter', () => {
    const ids = ADAPTERS.map((adapter) => adapter.id);
    assert.ok(
      !ids.some((id) => id.includes('fake')),
      'a fake on a 15-minute cron would write invented rows into quotes',
    );
  });

  it('reports all eight providers as uncovered', () => {
    const report = inspectRegistry();
    assert.equal(report.uncovered.length, 8);
    assert.deepEqual(report.uncovered, PROVIDERS.map((p) => p.id).sort());
    assert.deepEqual(report.problems, [], 'empty is not incoherent');
  });
});

describe('coherence against the seeded catalogue', () => {
  it('accepts the real shape: six adapters over eight providers', () => {
    const adapters = [
      createFakeReferenceAdapter({ id: 'trm', kind: 'trm' }),
      createFakeReferenceAdapter({ id: 'mid_market', kind: 'mid_market' }),
      createFakeQuoteAdapter({ id: 'bitso', providerIds: ['bitso'] }),
      createFakeQuoteAdapter({ id: 'buda', providerIds: ['buda'] }),
      createFakeQuoteAdapter({ id: 'dolarapp', providerIds: ['dolarapp'] }),
      createFakeQuoteAdapter({ id: 'eldorado', providerIds: ['eldorado'] }),
      createFakeQuoteAdapter({ id: 'binance_p2p', providerIds: ['binance_p2p'] }),
      createFakeQuoteAdapter({
        id: 'wise',
        mode: 'remesa',
        providerIds: ['wise', 'instarem', 'western_union'],
      }),
    ];

    const report = inspectRegistry(adapters);
    assert.deepEqual(report.problems, []);
    assert.deepEqual(report.uncovered, [], 'every catalogued provider has a source');
    assert.equal(report.adapterCount, 8, 'six quote adapters plus two references');
    assert.equal(report.coveredProviderCount, 8);
    assert.doesNotThrow(() => assertRegistryIsCoherent(adapters));
  });

  it('catches a provider claimed by two adapters', () => {
    // The N2 failure in its other form: bitso covered twice would count as two
    // providers lost when one adapter goes down, and look covered when the
    // real source is the one that died.
    const adapters = [
      createFakeQuoteAdapter({ id: 'bitso', providerIds: ['bitso'] }),
      createFakeQuoteAdapter({ id: 'bitso_mirror', providerIds: ['bitso'] }),
    ];

    const report = inspectRegistry(adapters);
    assert.equal(report.problems.length, 1);
    assert.match(report.problems[0] ?? '', /claimed by both bitso and bitso_mirror/);
    assert.throws(() => assertRegistryIsCoherent(adapters), /incoherent/);
  });

  it('catches a provider that is not in the catalogue', () => {
    const adapters = [createFakeQuoteAdapter({ id: 'ghost', providerIds: ['not_a_provider'] })];

    const report = inspectRegistry(adapters);
    assert.match(
      report.problems[0] ?? '',
      /claims 'not_a_provider', which is not in the catalogue/,
    );
  });

  it('catches a duplicate adapter id', () => {
    const adapters = [
      createFakeQuoteAdapter({ id: 'bitso', providerIds: ['bitso'] }),
      createFakeQuoteAdapter({ id: 'bitso', providerIds: ['buda'] }),
    ];

    assert.match(inspectRegistry(adapters).problems[0] ?? '', /duplicate adapter id: bitso/);
  });

  it('catches an adapter that declares no providers at all', () => {
    const adapters = [createFakeQuoteAdapter({ id: 'empty', providerIds: [] })];
    assert.match(inspectRegistry(adapters).problems[0] ?? '', /declares no providers/);
  });
});

describe('splitting the registry by kind', () => {
  it('separates quote adapters from references', () => {
    const adapters = [
      createFakeReferenceAdapter({ id: 'trm', kind: 'trm' }),
      createFakeQuoteAdapter({ id: 'bitso', providerIds: ['bitso'] }),
    ];

    assert.deepEqual(
      quoteAdapters(adapters).map((a) => a.id),
      ['bitso'],
    );
    assert.deepEqual(
      referenceAdapters(adapters).map((a) => a.id),
      ['trm'],
    );
  });
});
