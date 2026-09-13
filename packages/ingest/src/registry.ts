/**
 * The active adapter registry (T009).
 *
 * Adding a source is adding one line here and nothing else (Art. II.4). The
 * orchestrator never imports an adapter: it receives this array, so a new
 * source cannot require a change anywhere in the orchestration path — and a
 * broken one cannot be reached by anything except `Promise.allSettled`.
 *
 * Both references are in (T010, T011), and three quote adapters: `bitso`,
 * `dolarapp`, `buda` (T012-T014). Three to go — `eldorado`, `binance_p2p` and
 * `wise` (T015-T017) — each adding its line here and changing nothing else.
 *
 * The fake adapters are deliberately absent. They exist to exercise the
 * orchestrator in tests, and a fake in the production registry would write
 * invented rows into `quotes` on a 15-minute cron.
 */

import { createBitsoAdapter } from './adapters/bitso.ts';
import { createBudaAdapter } from './adapters/buda.ts';
import { createDolarAppAdapter } from './adapters/dolarapp.ts';
import type { Adapter, QuoteAdapter, ReferenceAdapter } from './contract.ts';
import { PROVIDERS } from './lib/providers.ts';
import { createMidMarketAdapter } from './references/mid-market.ts';
import { createTrmAdapter } from './references/trm.ts';

export const ADAPTERS: Adapter[] = [
  createTrmAdapter(),
  createMidMarketAdapter(),
  createBitsoAdapter(),
  createDolarAppAdapter(),
  createBudaAdapter(),
  // T015 — eldorado       (quote, 1 provider)
  // T016 — binance_p2p    (quote, 1 provider)
  // T017 — wise           (quote, 3 providers)
];

export type RegistryReport = {
  problems: string[];
  /** Catalogued providers no adapter claims. Expected to shrink to zero by T017. */
  uncovered: string[];
  adapterCount: number;
  coveredProviderCount: number;
};

/**
 * Checks the registry against the seeded catalogue.
 *
 * This exists because `providerIds` made a new class of mistake possible: an
 * adapter can now claim a provider that does not exist, or two adapters can
 * claim the same one. Either would corrupt the coverage metric silently — the
 * exact failure N2 was about — and neither is visible by reading one file.
 */
export function inspectRegistry(adapters: Adapter[] = ADAPTERS): RegistryReport {
  const problems: string[] = [];
  const known = new Set(PROVIDERS.map((provider) => provider.id));

  const seenAdapterIds = new Set<string>();
  const claimedBy = new Map<string, string>();

  for (const adapter of adapters) {
    if (seenAdapterIds.has(adapter.id)) {
      problems.push(`duplicate adapter id: ${adapter.id}`);
    }
    seenAdapterIds.add(adapter.id);

    if (adapter.kind !== 'quote') continue;

    if (adapter.providerIds.length === 0) {
      problems.push(`${adapter.id} declares no providers`);
    }

    for (const providerId of adapter.providerIds) {
      if (!known.has(providerId)) {
        problems.push(`${adapter.id} claims '${providerId}', which is not in the catalogue`);
      }

      const owner = claimedBy.get(providerId);
      if (owner !== undefined) {
        // Two adapters covering one provider would double-count it as lost,
        // and make a provider look covered when its real source is down.
        problems.push(`'${providerId}' is claimed by both ${owner} and ${adapter.id}`);
      } else {
        claimedBy.set(providerId, adapter.id);
      }
    }
  }

  const uncovered = [...known].filter((id) => !claimedBy.has(id)).sort();

  return {
    problems,
    uncovered,
    adapterCount: adapters.length,
    coveredProviderCount: claimedBy.size,
  };
}

/** Throws on anything that would corrupt the coverage metric. */
export function assertRegistryIsCoherent(adapters: Adapter[] = ADAPTERS): void {
  const { problems } = inspectRegistry(adapters);
  if (problems.length > 0) {
    throw new Error(`registry is incoherent:\n  - ${problems.join('\n  - ')}`);
  }
}

export function quoteAdapters(adapters: Adapter[] = ADAPTERS): QuoteAdapter[] {
  return adapters.filter((adapter): adapter is QuoteAdapter => adapter.kind === 'quote');
}

export function referenceAdapters(adapters: Adapter[] = ADAPTERS): ReferenceAdapter[] {
  return adapters.filter((adapter): adapter is ReferenceAdapter => adapter.kind === 'reference');
}
