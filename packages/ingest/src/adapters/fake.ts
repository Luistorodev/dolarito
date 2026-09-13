/**
 * The fake adapter (T007).
 *
 * Fixed rows, no network, so the orchestrator can be exercised end to end
 * before a single real source exists. It is not a stub that returns whatever is
 * convenient: it goes through `computeAmounts()` like a real `computed` adapter
 * does, so the shape it produces is the shape T008 will actually have to
 * persist.
 *
 * It covers both of the paths Art. I.2 separates, which is the whole reason it
 * exists in two flavours:
 *
 *   - **`out_of_range`** — we asked, and the provider does not operate at that
 *     amount. That IS an observation: it writes a row, with `limit_reason`.
 *   - **throwing** — we could not ask at all. That is NOT an observation: no
 *     row, and the orchestrator records it in `runs.sources_failed`.
 *
 * Conflating those two is what would silently break the silence alarm in T019,
 * so the fake makes both easy to trigger on purpose.
 */

import type { Quote, QuoteAdapter } from '../contract.ts';
import { computeAmounts } from '../money.ts';

export const FAKE_BRACKETS = [1, 100, 500, 1000] as const;

const DIRECTIONS = ['usd_to_cop', 'cop_to_usd'] as const;

export type FakeAdapterOptions = {
  id?: string;
  /**
   * Defaults to a value that is deliberately NOT one of the eight seeded
   * providers. Persisting these rows would violate the foreign key, which is
   * correct: fake quotes have no business in `quotes`. A test that does want to
   * persist them passes a real provider id.
   */
  providerId?: string;
  /**
   * The providers this adapter is the only source for. Defaults to just
   * `providerId`. Pass several to stand in for Wise, whose one call covers
   * three providers — the shape the coverage metric has to survive.
   */
  providerIds?: string[];
  mode?: 'local' | 'remesa';
  asset?: 'usd' | 'usdt' | 'usdc';
  channel?: 'exchange' | 'p2p' | 'bank_transfer' | 'fintech';
  grossRate?: number;
  feePct?: number;
  feeFixedUsd?: number;
  /** Brackets below this come back `out_of_range` / `below_minimum`. */
  minimumUsd?: number;
  /** Injected so rows are reproducible in a test. */
  now?: () => string;
};

type Resolved = Required<Omit<FakeAdapterOptions, 'feePct' | 'feeFixedUsd'>> & {
  feePct: number | undefined;
  feeFixedUsd: number | undefined;
};

function resolve(options: FakeAdapterOptions): Resolved {
  return {
    id: options.id ?? 'fake',
    providerId: options.providerId ?? '__fake__',
    providerIds: options.providerIds ?? [options.providerId ?? '__fake__'],
    mode: options.mode ?? 'local',
    asset: options.asset ?? 'usdt',
    channel: options.channel ?? 'exchange',
    grossRate: options.grossRate ?? 3080,
    feePct: options.feePct,
    feeFixedUsd: options.feeFixedUsd,
    // 5 USD mirrors Eldorado's floor, so the bracket of 1 exercises
    // `below_minimum` the way a real source will.
    minimumUsd: options.minimumUsd ?? 5,
    now: options.now ?? (() => new Date().toISOString()),
  };
}

function buildQuote(
  config: Resolved,
  direction: (typeof DIRECTIONS)[number],
  bracket: (typeof FAKE_BRACKETS)[number],
): Quote {
  const common = {
    provider_id: config.providerId,
    mode: config.mode,
    asset: config.asset,
    channel: config.channel,
    direction,
    bracket_usd: bracket,
    fixed_side: direction === 'usd_to_cop' ? ('in' as const) : ('out' as const),
    raw: { fake: true, direction, bracket_usd: bracket },
    captured_at: config.now(),
  };

  if (bracket < config.minimumUsd) {
    // Asked and answered: the provider does not go this low. No amounts,
    // because it never quoted any — undefined, never zero (Art. I.1).
    return {
      ...common,
      status: 'out_of_range',
      limit_reason: 'below_minimum',
      amounts_source: 'computed',
    };
  }

  const amounts = computeAmounts({
    direction,
    bracket_usd: bracket,
    gross_rate: config.grossRate,
    ...(config.feePct === undefined ? {} : { fee_pct: config.feePct }),
    ...(config.feeFixedUsd === undefined ? {} : { fee_fixed_usd: config.feeFixedUsd }),
  });

  return {
    ...common,
    status: 'ok',
    in: amounts.in,
    out: amounts.out,
    fixed_side: amounts.fixed_side,
    gross_rate: config.grossRate,
    ...(config.feePct === undefined ? {} : { fee_pct: config.feePct }),
    ...(config.feeFixedUsd === undefined ? {} : { fee_fixed_usd: config.feeFixedUsd }),
    amounts_source: 'computed',
  };
}

/**
 * A healthy adapter: eight rows, two directions across the four brackets, with
 * the bracket of 1 USD coming back `out_of_range`.
 */
export function createFakeQuoteAdapter(options: FakeAdapterOptions = {}): QuoteAdapter {
  const config = resolve(options);

  return {
    id: config.id,
    kind: 'quote',
    mode: config.mode,
    providerIds: config.providerIds,
    fetchQuotes: async (brackets: number[]): Promise<Quote[]> => {
      const wanted = FAKE_BRACKETS.filter((bracket) => brackets.includes(bracket));

      return DIRECTIONS.flatMap((direction) =>
        wanted.map((bracket) => buildQuote(config, direction, bracket)),
      );
    },
  };
}

/** Thrown by the failing fake, so a test can assert on the type. */
export class FakeAdapterFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FakeAdapterFailure';
  }
}

/**
 * An adapter that cannot answer at all.
 *
 * It must produce NO rows — not a row marked failed, not an empty `ok`. The
 * orchestrator turns this into a `sources_failed` entry and nothing else
 * (Art. I.2), which is what lets absence in `quotes` mean real absence.
 */
export function createThrowingQuoteAdapter(options: FakeAdapterOptions = {}): QuoteAdapter {
  const config = resolve(options);

  return {
    id: options.id ?? 'fake_failing',
    kind: 'quote',
    mode: config.mode,
    providerIds: config.providerIds,
    fetchQuotes: async (): Promise<Quote[]> => {
      throw new FakeAdapterFailure('fake adapter: the source could not be reached');
    },
  };
}
