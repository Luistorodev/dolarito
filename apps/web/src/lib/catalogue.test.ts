/**
 * The display catalogue must not drift from the captured one.
 *
 * Two lists of the same eight providers exist on purpose (see `catalogue.ts`),
 * and two lists of anything drift. This reads the ingest package's source and
 * compares — structural check for a structural risk, like the T009 test that
 * reads `orchestrator.ts` rather than trusting that nobody will add an import.
 *
 * Reading the source rather than importing it is the point: importing would
 * create exactly the dependency the split exists to avoid.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { PROVIDER_IDS, PROVIDERS, providerName } from './catalogue.ts';

const INGEST_CATALOGUE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../packages/ingest/src/lib/providers.ts',
);

/** Ids as the capture side declares them, read out of the file. */
function capturedIds(): string[] {
  const source = readFileSync(INGEST_CATALOGUE, 'utf8');
  return [...source.matchAll(/^\s*id: '([a-z_0-9]+)',/gm)].map((match) => String(match[1]));
}

describe('the two catalogues agree', () => {
  it('finds the ingest catalogue where it expects to', () => {
    // If this file moves, the test must fail loudly rather than silently
    // compare against nothing.
    assert.ok(capturedIds().length > 0, `no ids parsed from ${INGEST_CATALOGUE}`);
  });

  it('has exactly the same eight ids', () => {
    assert.deepEqual([...PROVIDER_IDS].sort(), capturedIds().sort());
  });

  it('agrees on which mode each provider belongs to', () => {
    // Getting this wrong puts a remittance provider in the Local ranking,
    // which compares a bank transfer against a stablecoin trade.
    const source = readFileSync(INGEST_CATALOGUE, 'utf8');
    for (const provider of PROVIDERS) {
      const block = new RegExp(`id: '${provider.id}',[\\s\\S]{0,200}?mode: '(local|remesa)'`);
      const found = block.exec(source);
      assert.ok(found !== null, `no mode found for ${provider.id}`);
      assert.equal(provider.mode, found[1], `${provider.id} disagrees on mode`);
    }
  });

  it('splits five local and three remesa, which N2 depends on', () => {
    // The empty-mode rule of plan.md §5.1 counts on Wise's three being the
    // whole of Remesa.
    assert.equal(PROVIDERS.filter((p) => p.mode === 'local').length, 5);
    assert.equal(PROVIDERS.filter((p) => p.mode === 'remesa').length, 3);
  });
});

describe('display names', () => {
  it('turns an identifier into something a reader recognises', () => {
    assert.equal(providerName('binance_p2p'), 'Binance P2P');
    assert.equal(providerName('western_union'), 'Western Union');
  });

  it('falls back to the id rather than hiding a real price', () => {
    // Ugly enough to notice, honest enough to use. Dropping the row would lose
    // a captured price because of a missing label.
    assert.equal(providerName('proveedor_nuevo'), 'proveedor_nuevo');
  });

  it('gives every provider a name that is not just its id', () => {
    for (const provider of PROVIDERS) {
      assert.notEqual(provider.name, provider.id, `${provider.id} has no display name`);
    }
  });
});
