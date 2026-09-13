/**
 * TRM — Tasa Representativa del Mercado (T010).
 *
 * A `ReferenceAdapter`: it writes onto the `runs` row of its own cycle, never
 * into `quotes`. The TRM is not an offer anyone can take, so it never enters a
 * ranking (Art. III.4).
 *
 * ---
 *
 * **The validity window comes from the datum, not from a calendar.** Each record
 * carries `vigenciadesde` and `vigenciahasta`, and one rate governs until the
 * next takes over. That is what makes weekends and Colombian public holidays a
 * non-problem: we never have to know which days are holidays, because the source
 * already told us how long its own number rules.
 *
 * Verified against the live endpoint on 2026-09-13:
 *
 *   | vigenciadesde | vigenciahasta | span   |
 *   |---|---|---|
 *   | 2026-09-12 (Sat) | 2026-09-14 (Mon) | 3 days |
 *   | 2026-09-11 (Fri) | 2026-09-11 (Fri) | 1 day  |
 *
 * The weekend record was published on Friday the 11th at 23:05 GMT and takes
 * effect on Saturday — publication and validity are different dates, which is
 * exactly why reading the window off the record beats inferring it.
 *
 * Both are saved in `fixtures/`, and the multi-day one is the case that can
 * actually break: a naive adapter that assumed one row equals one day would pass
 * every weekday and be wrong every weekend.
 */

import type { Reference, ReferenceAdapter } from '../contract.ts';
import { type HttpOptions, httpJson } from '../http.ts';

/**
 * The space in `$order=vigenciadesde DESC` has to be encoded. Left raw it is
 * accepted by some clients and rejected by others, which is the sort of thing
 * that works until it does not.
 */
export const TRM_URL =
  'https://www.datos.gov.co/resource/32sa-8pi3.json?$limit=1&$order=vigenciadesde%20DESC';

/** One record as datos.gov.co returns it. Every field arrives as a string. */
export type TrmRecord = {
  valor?: string;
  unidad?: string;
  vigenciadesde?: string;
  vigenciahasta?: string;
};

/** `2026-09-12T00:00:00.000` -> `2026-09-12`. The columns are `date`. */
function toDate(timestamp: string): string {
  const day = timestamp.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    throw new Error(`TRM: unreadable date '${timestamp}'`);
  }
  return day;
}

export function parseTrm(records: TrmRecord[]): Reference {
  const record = records[0];
  if (record === undefined) {
    throw new Error('TRM: the endpoint returned no records');
  }

  const { valor, vigenciadesde, vigenciahasta } = record;

  if (valor === undefined || vigenciadesde === undefined || vigenciahasta === undefined) {
    throw new Error(
      `TRM: a required field is missing (valor, vigenciadesde, vigenciahasta): ${JSON.stringify(record)}`,
    );
  }

  const value = Number(valor);
  if (!Number.isFinite(value) || value <= 0) {
    // Never a zero, never a guess. A TRM we cannot read is a failed source, and
    // the orchestrator records it as one (Art. I.1, Art. I.2).
    throw new Error(`TRM: 'valor' is not a usable number: ${valor}`);
  }

  return {
    kind: 'trm',
    value,
    source: 'datos_gov',
    valid_from: toDate(vigenciadesde),
    valid_to: toDate(vigenciahasta),
    raw: records,
  };
}

export function createTrmAdapter(options: HttpOptions = {}): ReferenceAdapter {
  return {
    id: 'trm',
    kind: 'reference',
    fetchReference: async (): Promise<Reference> => {
      const records = await httpJson<TrmRecord[]>(TRM_URL, options);
      return parseTrm(records);
    },
  };
}
