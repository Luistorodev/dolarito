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

/**
 * Una cota: el monto pedido cae entre dos brackets medidos.
 *
 * No es una interpolación. Los dos extremos son observaciones reales y lo que
 * se afirma es que el valor verdadero está entre ellas — afirmación que solo se
 * sostiene si la tasa efectiva es monótona en el monto, **y eso se comprueba en
 * la propia corrida antes de ofrecerla**, no se da por supuesto.
 *
 * Medido sobre la ventana de T020: `wise` y `western_union` resultaron
 * monótonas en **1.152 de 1.152 corridas**, lo cual es esperable —una comisión
 * fija se diluye a más monto— pero el código no se apoya en esa expectativa. Se
 * apoya en los brackets que tiene delante.
 */
export type Bound = {
  readonly quote: LatestQuote;
  /** Pesos en el bracket medido por debajo del monto pedido. */
  readonly lower: { readonly pesos: number; readonly usd: number };
  /** Pesos en el bracket medido por encima. */
  readonly upper: { readonly pesos: number; readonly usd: number };
  /** Pesos por dólar en cada extremo, que es lo comparable entre montos. */
  readonly lowerRate: number;
  readonly upperRate: number;
};

export type Conversion = {
  /** Calculadas al monto pedido. Comparables entre sí. */
  readonly exact: ConvertedRow[];
  /** Acotadas entre dos brackets medidos, cuando la corrida lo permite. */
  readonly bounded: Bound[];
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

  // **Cero no es una comisión.** La primera versión preguntaba si el campo era
  // no-nulo y mandaba a `instarem` al grupo aproximado teniendo una sola tasa y
  // cobrando 0 — medido: un único valor `fee_fixed_usd = 0` en 4.608 filas de
  // toda la ventana. Preguntar por la existencia del campo en vez de por su
  // valor es la misma familia de error que confundir "no medido" con "cero".
  const hasFee = usable.some(
    (r) => Number(r.fee_pct ?? 0) !== 0 || Number(r.fee_fixed_usd ?? 0) !== 0,
  );
  if (hasFee) return false;

  const rates = new Set(usable.map((r) => Number(r.gross_rate)));
  return rates.size === 1;
}

/**
 * Los dos brackets que encierran el monto, si la corrida los tiene Y su tasa
 * efectiva es monótona entre ellos.
 *
 * Devuelve `undefined` en cuanto falta cualquiera de las dos condiciones. Es
 * deliberado que sea fácil de no cumplir: una cota mal fundada es peor que
 * ninguna, porque parece información.
 */
function boundAround(
  rows: readonly LatestQuote[],
  amount: number,
  receives: boolean,
): Bound | undefined {
  const priced = rows
    .filter((r) => r.status === 'ok')
    .map((r) => {
      const pesos = pesosOf(r);
      return pesos === undefined ? undefined : { quote: r, pesos, usd: r.bracket_usd };
    })
    .filter((x): x is { quote: LatestQuote; pesos: number; usd: number } => x !== undefined)
    .sort((a, b) => a.usd - b.usd);

  if (priced.length < 2) return undefined;

  // Monotonía comprobada en esta corrida, sobre pesos por dólar. Al vender la
  // tasa efectiva debe subir con el monto; al comprar, bajar.
  for (let i = 1; i < priced.length; i += 1) {
    const prev = priced[i - 1];
    const cur = priced[i];
    if (prev === undefined || cur === undefined) return undefined;
    const before = prev.pesos / prev.usd;
    const after = cur.pesos / cur.usd;
    if (receives ? after < before : after > before) return undefined;
  }

  let lower: { quote: LatestQuote; pesos: number; usd: number } | undefined;
  let upper: { quote: LatestQuote; pesos: number; usd: number } | undefined;
  for (const row of priced) {
    if (row.usd <= amount) lower = row;
    if (row.usd >= amount && upper === undefined) upper = row;
  }
  // Fuera del rango medido no hay cota: extrapolar es justo lo que no se hace.
  if (lower === undefined || upper === undefined || lower.usd === upper.usd) return undefined;

  return {
    quote: upper.quote,
    lower: { pesos: lower.pesos, usd: lower.usd },
    upper: { pesos: upper.pesos, usd: upper.usd },
    lowerRate: lower.pesos / lower.usd,
    upperRate: upper.pesos / upper.usd,
  };
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
  const bounded: Bound[] = [];
  const measured: ConvertedRow[] = [];
  const receives = direction === 'usd_to_cop';

  if (!Number.isFinite(amount) || amount <= 0) return { exact, bounded, measured };

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

    // Segundo intento antes de rendirse: si el monto cae entre dos brackets
    // medidos y la corrida es monótona, se puede acotar con los dos extremos.
    const bound = boundAround(priced, amount, receives);
    if (bound !== undefined) {
      bounded.push(bound);
      continue;
    }

    // Sin monto libre ni cota: el bracket medido más cercano, declarado como
    // tal. No se interpola: un número entre dos brackets es una observación
    // que nadie hizo.
    const nearest = nearestBracket(priced, amount);
    const pesos = nearest === undefined ? undefined : pesosOf(nearest);
    if (nearest !== undefined && pesos !== undefined) {
      measured.push({ quote: nearest, pesos, usd: nearest.bracket_usd, exact: false });
    }
  }

  // Art. III.1: el orden sale del lado variable, no de la tasa anunciada.

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

  // Las cotas se ordenan por el extremo conservador: vendiendo, por lo menos
  // que podrías recibir; comprando, por lo más que podrías pagar. Prometer por
  // el extremo bueno es la forma amable de exagerar.
  bounded.sort((a, b) =>
    receives ? a.lowerRate - b.lowerRate || b.upperRate - a.upperRate : a.upperRate - b.upperRate,
  );
  if (receives) bounded.reverse();

  return { exact: exactRows, bounded, measured: measuredRows };
}
