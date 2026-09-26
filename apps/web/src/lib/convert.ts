/**
 * Converting a free amount (T031, ampliación de HU-04).
 *
 * ## Por qué no todos los proveedores admiten cualquier monto
 *
 * El Art. III.3 dice que toda comparación es a monto fijo «porque el precio
 * depende del monto». Para una parte del catálogo eso es literal y para otra
 * no, y la diferencia se lee del dato:
 *
 * - **`bitso`, `buda`, `dolarapp`** publican un ticker: un precio para todos,
 *   igual en los cuatro brackets y sin comisión. `monto × gross_rate` reproduce
 *   cada importe guardado con un desvío máximo de 0,44 COP, que es el redondeo
 *   al peso que `money.ts` ya aplica. Para ellos, cualquier monto es exacto.
 * - **`binance_p2p`** promedia el libro de órdenes: a más monto, peores
 *   anuncios. Su tasa cambia entre brackets, así que extrapolar sería inventar.
 * - **`eldorado`, `wise`, `instarem`, `western_union`** cobran comisión, y no es
 *   proporcional: Wise cobra 3,29 USD a 100, 9,40 a 500 y 17,03 a 1000.
 *   Interpolar entre esos puntos produce un número que nadie cotizó.
 *
 * **La regla se deriva del dato en cada corrida, nunca de una lista de
 * proveedores escrita acá.** Si mañana Bitso empieza a cobrar comisión, o si el
 * ticker pasa a variar por monto, cae solo a modo bracket. La dirección del
 * fallo importa: se degrada a decir menos, no a inventar más.
 *
 * ## Por qué los dos grupos no se mezclan en un solo orden
 *
 * Poner «Bitso 802.375 por tus 250 USD» arriba de «Wise 309.952, medido a 100»
 * y llamarlo ranking sería comparar dos montos distintos como si fueran uno —
 * exactamente lo que el Art. III.3 prohíbe. Así que `convert()` devuelve dos
 * listas, cada una ordenada por dentro, y la interfaz las presenta separadas.
 */
import type { LatestQuote } from './quotes.ts';
import { UNDECIDED_PROVIDER } from './ranking.ts';

/** Una fila convertida. `exact` dice si la cifra es del monto pedido. */
export type ConvertedRow = {
  readonly quote: LatestQuote;
  /** Pesos recibidos al vender, o pagados al comprar. */
  readonly pesos: number;
  /** El monto en dólares al que corresponde la cifra. */
  readonly usd: number;
  /** `false` significa que `usd` es el bracket medido, no el que se pidió. */
  readonly exact: boolean;
};

export type Conversion = {
  /** Calculadas al monto pedido. Comparables entre sí. */
  readonly exact: ConvertedRow[];
  /** Al bracket medido más cercano. Comparables entre sí, no con las de arriba. */
  readonly measured: ConvertedRow[];
};

/** Lo que identifica una oferta: un proveedor y, si lo tiene, su método. */
function laneOf(quote: LatestQuote): string {
  return `${quote.provider_id}|${quote.payment_method ?? ''}`;
}

/**
 * Si una oferta admite cualquier monto, leído del dato.
 *
 * Las dos condiciones son necesarias y ninguna alcanza sola: `wise` e
 * `instarem` publican una sola tasa y aun así cobran comisión, y `binance_p2p`
 * no cobra comisión y aun así su tasa depende del monto.
 */
export function acceptsFreeAmount(rows: readonly LatestQuote[]): boolean {
  const usable = rows.filter((r) => r.status === 'ok' && r.gross_rate !== null);
  if (usable.length < 2) return false;

  const hasFee = usable.some((r) => r.fee_pct !== null || r.fee_fixed_usd !== null);
  if (hasFee) return false;

  const rates = new Set(usable.map((r) => Number(r.gross_rate)));
  return rates.size === 1;
}

/** Al peso, mitad hacia arriba — la política de `money.ts`, no una nueva. */
function toPeso(value: number): number {
  return Math.round(value);
}

/** La fila cuyo bracket queda más cerca del monto pedido. */
function nearestBracket(rows: readonly LatestQuote[], amount: number): LatestQuote | undefined {
  let best: LatestQuote | undefined;
  let bestGap = Number.POSITIVE_INFINITY;
  for (const row of rows) {
    const gap = Math.abs(row.bracket_usd - amount);
    if (gap < bestGap) {
      best = row;
      bestGap = gap;
    }
  }
  return best;
}

/** Los pesos de una fila: lo que se recibe vendiendo o lo que se paga comprando. */
function pesosOf(quote: LatestQuote): number | undefined {
  const value = quote.fixed_side === 'in' ? quote.amount_out : quote.amount_in;
  return value === null ? undefined : Number(value);
}

/**
 * Convierte un monto para una dirección.
 *
 * Ordena por el lado variable, igual que `rank()` (Art. III.1): vendiendo gana
 * quien entrega más pesos, comprando quien cobra menos. Nunca por la tasa.
 */
export function convert(
  quotes: readonly LatestQuote[],
  amount: number,
  direction: LatestQuote['direction'],
): Conversion {
  const exact: ConvertedRow[] = [];
  const measured: ConvertedRow[] = [];

  if (!Number.isFinite(amount) || amount <= 0) return { exact, measured };

  const lanes = new Map<string, LatestQuote[]>();
  for (const quote of quotes) {
    if (quote.direction !== direction) continue;
    const lane = laneOf(quote);
    lanes.set(lane, [...(lanes.get(lane) ?? []), quote]);
  }

  for (const rows of lanes.values()) {
    const priced = rows.filter((r) => r.status === 'ok');

    if (acceptsFreeAmount(rows)) {
      // Cualquiera sirve de plantilla: por definición todas llevan la misma
      // tasa. Se toma la del bracket más cercano para que `captured_at` y el
      // resto de la fila sean los de la observación más parecida.
      const template = nearestBracket(priced, amount);
      const rate = template?.gross_rate;
      if (template !== undefined && rate !== null && rate !== undefined) {
        exact.push({
          quote: template,
          pesos: toPeso(amount * Number(rate)),
          usd: amount,
          exact: true,
        });
        continue;
      }
    }

    // Sin monto libre: el bracket medido más cercano, declarado como tal. No se
    // interpola: un número entre dos brackets es una observación que nadie hizo.
    const nearest = nearestBracket(priced, amount);
    const pesos = nearest === undefined ? undefined : pesosOf(nearest);
    if (nearest !== undefined && pesos !== undefined) {
      measured.push({ quote: nearest, pesos, usd: nearest.bracket_usd, exact: false });
    }
  }

  // Art. III.1: el orden sale del lado variable, no de la tasa anunciada.
  const receives = direction === 'usd_to_cop';

  /**
   * La política de El Dorado vale acá también, y esto es un defecto corregido.
   *
   * La primera versión agrupaba por proveedor **y método**, así que El Dorado
   * salía con sus cuatro filas mientras la home mostraba una. La decisión #1 de
   * T020 se tomó una vez, el 2026-09-21, y una decisión que solo rige en la
   * página donde se escribió no es una decisión: es una coincidencia.
   *
   * `best-method`, con el mismo criterio que `rank()`: se juzga por el lado
   * variable, así que "mejor" es más pesos vendiendo y menos comprando.
   */
  const collapseMethods = (rows: ConvertedRow[]): ConvertedRow[] => {
    const mine = rows.filter((r) => r.quote.provider_id === UNDECIDED_PROVIDER);
    if (mine.length <= 1) return rows;

    const others = rows.filter((r) => r.quote.provider_id !== UNDECIDED_PROVIDER);
    const best = mine.reduce((a, b) => {
      // Por pesos por dólar: entre métodos el bracket elegido es el mismo, pero
      // compararlos por tasa no depende de que lo sea.
      const ra = a.pesos / a.usd;
      const rb = b.pesos / b.usd;
      return (receives ? rb > ra : rb < ra) ? b : a;
    });
    return [...others, best];
  };
  const order = (a: ConvertedRow, b: ConvertedRow): number =>
    receives ? b.pesos - a.pesos : a.pesos - b.pesos;

  const exactRows = collapseMethods(exact);
  const measuredRows = collapseMethods(measured);

  exactRows.sort(order);
  // Las medidas se ordenan por pesos por dólar, no por pesos: entre ellas los
  // brackets pueden diferir, y comparar 500 contra 100 en pesos no dice nada.
  measuredRows.sort((a, b) => {
    const ra = a.pesos / a.usd;
    const rb = b.pesos / b.usd;
    return receives ? rb - ra : ra - rb;
  });

  return { exact: exactRows, measured: measuredRows };
}
