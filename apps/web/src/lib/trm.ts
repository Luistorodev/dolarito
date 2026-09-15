/**
 * The TRM block (T024, HU-05).
 *
 * ## The frozen indicator comes from the datum, not from a calendar
 *
 * Every TRM record carries `vigenciadesde` and `vigenciahasta`, and a rate
 * rules until the next one relieves it. So a rate that spans more than one
 * calendar day **is** the weekend-or-holiday case, and it says so itself:
 * `trm_to > trm_from`. There is no list of Colombian holidays in this
 * repository and there must not be one — T010 established that, and this is the
 * same property used for display instead of for capture.
 *
 * Measured examples from the real endpoint (T010):
 *
 * | desde | hasta | días | qué es |
 * |---|---|---|---|
 * | 2026-09-12 (sáb) | 2026-09-14 (lun) | 3 | fin de semana |
 * | 2026-09-11 (vie) | 2026-09-11 (vie) | 1 | día hábil |
 *
 * ## Why "today" needs a timezone
 *
 * `trm_from`/`trm_to` are dates with no time, and they mean Colombian calendar
 * days. Asking "does this cover today?" against a UTC date is wrong for the
 * five hours either side of midnight — the same offset that
 * `packages/ingest/src/silence.ts` uses to decide when a rate expires. Two
 * different questions, one underlying fact: **Colombia is UTC-5 all year, with
 * no daylight saving.** If that ever stopped being true, both places change.
 */

/** Colombia does not observe daylight saving, so one offset is a fact. */
const BOGOTA_OFFSET_MINUTES = -5 * 60;

/** The calendar date in Bogotá at `now`, as `YYYY-MM-DD`. */
export function bogotaToday(now: Date): string {
  const shifted = new Date(now.getTime() + BOGOTA_OFFSET_MINUTES * 60_000);
  return shifted.toISOString().slice(0, 10);
}

/** Whole days a `YYYY-MM-DD` range covers, inclusive of both ends. */
export function daysCovered(from: string, to: string): number {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end)) return 0;
  return Math.round((end - start) / 86_400_000) + 1;
}

export type TrmDisplay =
  | {
      kind: 'current';
      value: number;
      from: string;
      to: string;
      /** More than one day means it is carrying a weekend or a holiday. */
      frozen: boolean;
      days: number;
    }
  | {
      kind: 'stale';
      value: number;
      from: string;
      to: string;
      days: number;
    }
  /** No TRM in the captures we have. Not the same as a stale one. */
  | { kind: 'missing' };

export type TrmSource = {
  trm: number | null;
  trm_from: string | null;
  trm_to: string | null;
};

/**
 * What to show for the TRM.
 *
 * Three states rather than two, for the reason the silence alarm needed three:
 * "we hold an old rate" and "we hold no rate" look the same on a page that only
 * asks whether a number exists, and they are not the same thing to a reader.
 */
export function describeTrm(source: TrmSource | undefined, now: Date): TrmDisplay {
  if (
    source === undefined ||
    source.trm === null ||
    source.trm_from === null ||
    source.trm_to === null
  ) {
    return { kind: 'missing' };
  }

  const { trm: value, trm_from: from, trm_to: to } = source;
  const days = daysCovered(from, to);
  const today = bogotaToday(now);

  // Past its last valid day: we are showing a rate that no longer rules.
  if (today > to) return { kind: 'stale', value, from, to, days };

  return { kind: 'current', value, from, to, frozen: days > 1, days };
}

/**
 * How the frozen case is worded.
 *
 * Kept here rather than in the template so it can be tested, and because the
 * wording is the feature: HU-05's criterion is that the weekend state **looks
 * different** from a working day, and a number with no explanation looks the
 * same in both.
 */
export function frozenNote(display: TrmDisplay): string | undefined {
  if (display.kind !== 'current' || !display.frozen) return undefined;
  return (
    `Esta tasa cubre ${display.days} días: rige desde el ${display.from} hasta ` +
    `el ${display.to}. No se actualiza los fines de semana ni los festivos, ` +
    'así que hoy es la misma de ayer. No es un dato viejo.'
  );
}
