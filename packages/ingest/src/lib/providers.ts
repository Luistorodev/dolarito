/**
 * The provider catalogue (T004).
 *
 * These eight rows are the only entities that appear in rankings. References
 * are deliberately absent: TRM and the mid-market rate are not providers, they
 * live in `runs` (plan.md §2).
 *
 * This is hand-authored metadata, not source-derived data, so it is the one
 * place where values are written rather than observed. Nothing here is a price.
 */

export type ProviderMode = 'local' | 'remesa';
export type ProviderAsset = 'usd' | 'usdt' | 'usdc';
export type ProviderChannel = 'exchange' | 'p2p' | 'bank_transfer' | 'fintech';

export type ProviderRow = {
  readonly id: string;
  readonly name: string;
  readonly mode: ProviderMode;
  readonly asset: ProviderAsset;
  readonly channel: ProviderChannel;
  readonly site_url: string | null;
  readonly notes: string | null;
};

export const PROVIDERS: readonly ProviderRow[] = [
  // --- Local: entirely stablecoin, which the UI has to communicate (plan.md §2.1).
  {
    id: 'eldorado',
    name: 'El Dorado',
    mode: 'local',
    asset: 'usdt',
    channel: 'p2p',
    site_url: 'https://eldorado.io',
    notes: 'Quotes vary by payment method; 5 USD minimum (T015).',
  },
  {
    id: 'dolarapp',
    name: 'DolarApp',
    mode: 'local',
    asset: 'usdc',
    channel: 'fintech',
    site_url: 'https://dolarapp.com',
    notes: 'States no explicit fee, so fee_* stays undefined — never zero (Art. I.1).',
  },
  {
    id: 'binance_p2p',
    name: 'Binance P2P',
    mode: 'local',
    asset: 'usdt',
    channel: 'p2p',
    site_url: 'https://p2p.binance.com',
    notes:
      'No single price: the bracket is filled from the order book and weighted by volume (T016).',
  },
  {
    id: 'bitso',
    name: 'Bitso',
    mode: 'local',
    asset: 'usdt',
    channel: 'exchange',
    site_url: 'https://bitso.com',
    notes: 'Rate does not vary by amount; the variable side does, via computeAmounts().',
  },
  {
    id: 'buda',
    name: 'Buda',
    mode: 'local',
    asset: 'usdt',
    channel: 'exchange',
    site_url: 'https://www.buda.com',
    notes: 'Thin order book and a wide spread: read its quotes with that in mind (T014).',
  },

  // --- Remesa: the three that one Wise call returns (T017).
  {
    id: 'wise',
    name: 'Wise',
    mode: 'remesa',
    asset: 'usd',
    channel: 'bank_transfer',
    site_url: 'https://wise.com',
    notes: null,
  },
  {
    id: 'instarem',
    name: 'Instarem',
    mode: 'remesa',
    asset: 'usd',
    channel: 'bank_transfer',
    site_url: 'https://www.instarem.com',
    notes: 'Comes from the Wise comparison call, not from its own adapter (T017).',
  },
  {
    id: 'western_union',
    name: 'Western Union',
    mode: 'remesa',
    asset: 'usd',
    channel: 'bank_transfer',
    site_url: 'https://www.westernunion.com',
    notes: 'Comes from the Wise comparison call, not from its own adapter (T017).',
  },
];
