/**
 * The eight providers, for display.
 *
 * ## Why this exists when `packages/ingest/src/lib/providers.ts` already does
 *
 * Two reasons, and the first is the load-bearing one.
 *
 *  1. **Absence cannot be found by looking at rows.** T026 has to name a
 *     provider that produced nothing, and nothing is exactly what it left
 *     behind. The expected set must come from outside the data — the same
 *     reason `findSilentProviders` takes `expected` from the registry.
 *  2. The web tier needs display names anyway. `binance_p2p` is an identifier,
 *     not something to show a reader.
 *
 * ## And why it is not imported from the ingest package
 *
 * That module pulls in the Supabase client and the whole capture side. The web
 * tier reads with a different key and must not be able to write (N4); giving it
 * an import path into the ingest package makes that boundary a matter of
 * discipline rather than of structure.
 *
 * The cost is two lists that can drift. `catalogue.test.ts` closes that by
 * reading the ingest source and comparing ids — a structural check for a
 * structural risk, like the T009 test that reads `orchestrator.ts`.
 */

/**
 * What checking the site link actually established, on 2026-09-15.
 *
 * The eight URLs in `packages/ingest/src/lib/providers.ts` were written from
 * general knowledge and never checked. Publishing an unchecked link is a claim
 * about somebody else's business, so each was fetched once and the outcome
 * recorded here rather than assumed.
 *
 * A 200 with a matching title is not proof the page is the right company's for
 * all time — it is evidence the URL resolves to something calling itself that
 * today, which is more than was known before and less than certainty.
 */
export type SiteStatus =
  /** Resolved, and the page titles itself as this provider. */
  | 'verified'
  /** Reachable but could not be confirmed — no claim either way. */
  | 'unverified'
  /** Resolves somewhere that is NOT obviously this provider. Not published. */
  | 'needs_review';

export type DisplayProvider = {
  id: string;
  /** What a reader sees. `binance_p2p` is for the database. */
  name: string;
  mode: 'local' | 'remesa';
  site: string;
  siteStatus: SiteStatus;
  /** Why the status is what it is, in the words of the check that produced it. */
  siteNote?: string;
};

export const PROVIDERS: DisplayProvider[] = [
  {
    id: 'eldorado',
    name: 'El Dorado',
    mode: 'local',
    site: 'https://eldorado.io',
    siteStatus: 'verified',
  },
  {
    id: 'dolarapp',
    name: 'DolarApp',
    mode: 'local',
    site: 'https://dolarapp.com',
    siteStatus: 'needs_review',
    siteNote:
      'Redirige a arqfinance.com, cuyo título dice "ARQ". El adaptador sigue ' +
      'capturando precios, así que la API vive; lo que cambió es el sitio o la ' +
      'marca. Sin revisar, no se publica el enlace.',
  },
  {
    id: 'binance_p2p',
    name: 'Binance P2P',
    mode: 'local',
    site: 'https://p2p.binance.com',
    siteStatus: 'verified',
  },
  { id: 'bitso', name: 'Bitso', mode: 'local', site: 'https://bitso.com', siteStatus: 'verified' },
  {
    id: 'buda',
    name: 'Buda',
    mode: 'local',
    site: 'https://www.buda.com',
    siteStatus: 'unverified',
    siteNote:
      'Devolvió 403 detrás de Cloudflare. Eso no dice que la dirección esté mal ' +
      'ni que esté bien, y el Art. V.6 prohíbe rodear un bloqueo para averiguarlo.',
  },
  { id: 'wise', name: 'Wise', mode: 'remesa', site: 'https://wise.com', siteStatus: 'verified' },
  {
    id: 'instarem',
    name: 'Instarem',
    mode: 'remesa',
    site: 'https://www.instarem.com',
    siteStatus: 'verified',
  },
  {
    id: 'western_union',
    name: 'Western Union',
    mode: 'remesa',
    site: 'https://www.westernunion.com',
    siteStatus: 'verified',
  },
];

/** Whether the site link may be published as a link. */
export function linkable(provider: DisplayProvider): boolean {
  return provider.siteStatus !== 'needs_review';
}

const BY_ID = new Map(PROVIDERS.map((provider) => [provider.id, provider]));

/**
 * The display name, falling back to the id.
 *
 * A provider missing from this list still renders — with its identifier, which
 * is ugly enough to notice and honest enough to be useful. Hiding the row
 * instead would lose a real price because of a missing label.
 */
export function providerName(id: string): string {
  return BY_ID.get(id)?.name ?? id;
}

export const PROVIDER_IDS = PROVIDERS.map((provider) => provider.id);
