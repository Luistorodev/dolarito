/**
 * Tests for the orchestrator (T008).
 *
 * The run is exercised against an in-memory `RunStore`, so what is asserted is
 * what would have been written, row by row, without a database in the way.
 *
 * The two cases that matter most are in "the unit of the count": they are what
 * separates counting providers from counting adapters, and they were specified
 * before the code was written.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createFakeQuoteAdapter,
  createFakeReferenceAdapter,
  createThrowingQuoteAdapter,
  createThrowingReferenceAdapter,
} from './adapters/fake.ts';
import type { Quote, Reference } from './contract.ts';
import { HttpError } from './http.ts';
import { type RunStore, runIngest, type SourceFailure } from './orchestrator.ts';

const BRACKETS = [1, 100, 500, 1000];

/** Records everything the orchestrator tried to write. */
function memoryStore() {
  const saved = {
    runId: 'run-under-test',
    quotes: [] as Quote[],
    references: [] as Reference[],
    closed: undefined as
      | { sourcesOk: string[]; sourcesFailed: Record<string, SourceFailure> }
      | undefined,
    openCalls: 0,
  };

  const store: RunStore = {
    openRun: async () => {
      saved.openCalls += 1;
      return saved.runId;
    },
    saveReferences: async (_runId, references) => {
      saved.references.push(...references);
    },
    saveQuotes: async (_runId, quotes) => {
      saved.quotes.push(...quotes);
    },
    closeRun: async (_runId, summary) => {
      saved.closed = summary;
    },
  };

  return { store, saved };
}

/** The real shape: five local adapters and one remesa adapter covering three. */
function realisticAdapters(options: { failing?: string[] } = {}) {
  const failing = new Set(options.failing ?? []);

  const spec = [
    { id: 'eldorado', providerIds: ['eldorado'], mode: 'local' as const },
    { id: 'dolarapp', providerIds: ['dolarapp'], mode: 'local' as const },
    { id: 'binance_p2p', providerIds: ['binance_p2p'], mode: 'local' as const },
    { id: 'bitso', providerIds: ['bitso'], mode: 'local' as const },
    { id: 'buda', providerIds: ['buda'], mode: 'local' as const },
    {
      id: 'wise',
      providerIds: ['wise', 'instarem', 'western_union'],
      mode: 'remesa' as const,
    },
  ];

  return spec.map((entry) =>
    failing.has(entry.id)
      ? createThrowingQuoteAdapter(entry)
      : createFakeQuoteAdapter({ ...entry, providerId: entry.providerIds[0] ?? entry.id }),
  );
}

describe('a healthy adapter beside one that throws', () => {
  it('keeps the healthy rows, records the failure, and writes nothing for it', async () => {
    const { store, saved } = memoryStore();

    const outcome = await runIngest({
      adapters: [
        createFakeQuoteAdapter({ id: 'healthy', providerId: 'bitso' }),
        createThrowingQuoteAdapter({ id: 'broken', providerId: 'buda' }),
      ],
      store,
      brackets: BRACKETS,
    });

    assert.equal(saved.openCalls, 1, 'one run row per run');
    assert.equal(saved.quotes.length, 8, 'the healthy adapter still delivers all eight');
    assert.ok(
      saved.quotes.every((q) => q.provider_id === 'bitso'),
      'and not one row belongs to the adapter that threw',
    );

    assert.deepEqual(outcome.sourcesOk, ['healthy']);
    assert.deepEqual(Object.keys(outcome.sourcesFailed), ['broken']);
    assert.match(outcome.sourcesFailed['broken']?.message ?? '', /could not be reached/);

    assert.deepEqual(saved.closed?.sourcesOk, ['healthy']);
    assert.deepEqual(Object.keys(saved.closed?.sourcesFailed ?? {}), ['broken']);
  });

  it('resolves the references before the quotes, onto the same run', async () => {
    const { store, saved } = memoryStore();

    await runIngest({
      adapters: [
        createFakeQuoteAdapter({ id: 'bitso', providerId: 'bitso' }),
        createFakeReferenceAdapter({ id: 'trm', kind: 'trm', value: 4012.34 }),
        createFakeReferenceAdapter({ id: 'mid', kind: 'mid_market', value: 3990.5 }),
      ],
      store,
      brackets: BRACKETS,
    });

    assert.equal(saved.references.length, 2);
    assert.deepEqual(
      saved.references.map((r) => r.kind).sort(),
      ['mid_market', 'trm'],
      'both references land on the run',
    );
  });
});

describe('the unit of the count is the provider lost, not the adapter down', () => {
  it('one adapter down covering three providers of one mode exits non-zero', async () => {
    // Wise. Three providers, all of Remesa, from a single call.
    const { store } = memoryStore();

    const outcome = await runIngest({
      adapters: realisticAdapters({ failing: ['wise'] }),
      store,
      brackets: BRACKETS,
    });

    assert.equal(outcome.providersLost.length, 3, 'three providers, not one adapter');
    assert.deepEqual(outcome.providersLost.sort(), ['instarem', 'western_union', 'wise']);

    // The point of the second rule: three does NOT exceed four, so the count
    // alone stays silent. It exits because Remesa has nobody left.
    assert.ok(
      outcome.providersLost.length <= 4,
      'the count rule is not what fires here — that is the whole reason rule 2 exists',
    );
    assert.deepEqual(outcome.modesEmpty, ['remesa']);
    assert.equal(outcome.exitCode, 1);
    assert.equal(outcome.exitReasons.length, 1);
    assert.match(outcome.exitReasons[0] ?? '', /mode 'remesa' has no surviving provider/);
  });

  it('four local adapters down, four providers lost, does NOT exit', async () => {
    // Under the old adapter-based unit this run was red: four of six adapters
    // is more than half. Counted in providers it is four of eight, which does
    // not exceed four, and both modes still answer. It is correct that it
    // stays green.
    const { store } = memoryStore();

    const outcome = await runIngest({
      adapters: realisticAdapters({ failing: ['eldorado', 'dolarapp', 'binance_p2p', 'bitso'] }),
      store,
      brackets: BRACKETS,
    });

    assert.equal(outcome.providersLost.length, 4);
    assert.deepEqual(outcome.modesEmpty, [], 'buda holds Local, wise holds Remesa');
    assert.deepEqual(outcome.exitReasons, []);
    assert.equal(outcome.exitCode, 0);
  });

  it('five providers lost exits on the count alone', async () => {
    // Wise plus two local adapters: three adapters, five providers. Under the
    // adapter unit this was green; under the provider unit it is red.
    const { store } = memoryStore();

    const outcome = await runIngest({
      adapters: realisticAdapters({ failing: ['wise', 'bitso', 'buda'] }),
      store,
      brackets: BRACKETS,
    });

    assert.equal(outcome.providersLost.length, 5);
    assert.equal(outcome.exitCode, 1);
    assert.ok(
      outcome.exitReasons.some((reason) => reason.includes('5 providers lost')),
      'the count rule fires',
    );
  });

  it('an empty Local mode counts too — the rule is not about Remesa', async () => {
    const { store } = memoryStore();

    const outcome = await runIngest({
      adapters: realisticAdapters({
        failing: ['eldorado', 'dolarapp', 'binance_p2p', 'bitso', 'buda'],
      }),
      store,
      brackets: BRACKETS,
    });

    assert.deepEqual(outcome.modesEmpty, ['local']);
    assert.equal(outcome.exitCode, 1);
  });

  it('a fully healthy run exits zero', async () => {
    const { store } = memoryStore();

    const outcome = await runIngest({
      adapters: [
        ...realisticAdapters(),
        createFakeReferenceAdapter({ id: 'trm', kind: 'trm' }),
        createFakeReferenceAdapter({ id: 'mid', kind: 'mid_market' }),
      ],
      store,
      brackets: BRACKETS,
    });

    assert.deepEqual(outcome.providersLost, []);
    assert.deepEqual(outcome.modesEmpty, []);
    assert.deepEqual(outcome.referencesFailed, []);
    assert.equal(outcome.exitCode, 0);
  });
});

describe('why a source failed is recorded, not just that it did', () => {
  it('keeps status and attempts when the source answered badly', async () => {
    const { store } = memoryStore();
    const failing = createThrowingQuoteAdapter({ id: 'broken', providerId: 'bitso' });
    // Stand in for what the shared client throws on an exhausted 504.
    failing.fetchQuotes = async () => {
      throw new HttpError(
        'https://example.test -> HTTP 504 after 4 attempt(s)',
        'https://example.test',
        504,
        4,
      );
    };

    const outcome = await runIngest({ adapters: [failing], store, brackets: BRACKETS });
    const failure = outcome.sourcesFailed['broken'];

    assert.equal(failure?.kind, 'http');
    assert.equal(failure?.status, 504, 'the status is what separates a blip from a block');
    assert.equal(failure?.attempts, 4);
  });

  it('calls a transport failure by its own name, with no status', async () => {
    const { store } = memoryStore();
    const failing = createThrowingQuoteAdapter({ id: 'broken', providerId: 'bitso' });
    failing.fetchQuotes = async () => {
      throw new HttpError(
        'https://example.test -> fetch failed',
        'https://example.test',
        undefined,
        4,
      );
    };

    const outcome = await runIngest({ adapters: [failing], store, brackets: BRACKETS });
    assert.equal(outcome.sourcesFailed['broken']?.kind, 'transport');
    assert.equal(outcome.sourcesFailed['broken']?.status, undefined);
  });

  it('calls anything the adapter threw an adapter failure', async () => {
    // In practice this is what a silent format change looks like from here.
    const { store } = memoryStore();
    const outcome = await runIngest({
      adapters: [createThrowingQuoteAdapter({ id: 'broken', providerId: 'bitso' })],
      store,
      brackets: BRACKETS,
    });

    assert.equal(outcome.sourcesFailed['broken']?.kind, 'adapter');
    assert.equal(outcome.sourcesFailed['broken']?.status, undefined);
  });
});

describe('references are an incident, not degradation', () => {
  it('one failed reference exits non-zero even with every provider healthy', async () => {
    const { store } = memoryStore();

    const outcome = await runIngest({
      adapters: [
        ...realisticAdapters(),
        createThrowingReferenceAdapter({ id: 'trm', kind: 'trm' }),
        createFakeReferenceAdapter({ id: 'mid', kind: 'mid_market' }),
      ],
      store,
      brackets: BRACKETS,
    });

    assert.deepEqual(outcome.providersLost, [], 'every provider answered');
    assert.deepEqual(outcome.modesEmpty, []);
    assert.deepEqual(outcome.referencesFailed, ['trm']);
    assert.equal(outcome.exitCode, 1);
    assert.match(outcome.exitReasons[0] ?? '', /an incident, not degradation/);
  });

  it('a failed reference does not stop the quotes from being collected', async () => {
    const { store, saved } = memoryStore();

    await runIngest({
      adapters: [
        createFakeQuoteAdapter({ id: 'bitso', providerId: 'bitso' }),
        createThrowingReferenceAdapter({ id: 'trm', kind: 'trm' }),
      ],
      store,
      brackets: BRACKETS,
    });

    assert.equal(saved.quotes.length, 8, 'the run degrades, it does not abort');
    assert.equal(saved.references.length, 0);
  });
});
