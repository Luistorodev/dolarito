/**
 * T031. Lo que estos tests fijan no es "convierte bien": es **de dónde sale la
 * regla** de qué se puede convertir. Una lista de proveedores escrita a mano
 * pasaría todas las pruebas obvias y mentiría el día que Bitso cobre comisión.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { acceptsFreeAmount, convert } from './convert.ts';
import type { LatestQuote } from './quotes.ts';

function quote(overrides: Partial<LatestQuote>): LatestQuote {
  return {
    provider_id: 'bitso',
    mode: 'local',
    asset: 'usdt',
    channel: 'exchange',
    direction: 'usd_to_cop',
    bracket_usd: 100,
    payment_method: null,
    fixed_side: 'in',
    amount_in: 100,
    currency_in: 'USD',
    amount_out: 300_000,
    currency_out: 'COP',
    status: 'ok',
    limit_reason: null,
    gross_rate: 3000,
    effective_rate: 3000,
    fee_pct: null,
    fee_fixed_usd: null,
    fee_amount_usd: null,
    amounts_source: 'computed',
    eta_minutes: null,
    captured_at: '2026-09-26T12:00:00Z',
    trm: 3200,
    trm_from: '2026-09-26',
    trm_to: '2026-09-26',
    mid_market: 3190,
    mid_market_src: 'yahoo',
    mid_market_at: '2026-09-26T12:00:00Z',
    markup_vs_trm: 0.06,
    markup_vs_mid: 0.06,
    ...overrides,
  };
}

/** Un ticker: la misma tasa en los cuatro brackets y sin comisión. */
const ticker = (id: string, rate: number): LatestQuote[] =>
  [1, 100, 500, 1000].map((b) =>
    quote({
      provider_id: id,
      bracket_usd: b,
      gross_rate: rate,
      amount_in: b,
      amount_out: b * rate,
    }),
  );

describe('de dónde sale la regla de monto libre', () => {
  it('lo admite cuando la tasa no cambia y no hay comisión', () => {
    assert.equal(acceptsFreeAmount(ticker('bitso', 3200)), true);
  });

  it('NO lo admite si la tasa cambia con el monto, aunque no haya comisión', () => {
    // La forma de binance_p2p: promedia el libro, así que a más monto peor tasa.
    const book = ticker('binance_p2p', 3200);
    const deeper = book[3];
    assert.ok(deeper);
    const varying = [...book.slice(0, 3), quote({ ...deeper, gross_rate: 3180 })];
    assert.equal(acceptsFreeAmount(varying), false);
  });

  it('NO lo admite si hay comisión, aunque la tasa sea una sola', () => {
    // La forma de wise: una tasa publicada y una comisión que escala aparte.
    const withFee = ticker('wise', 3200).map((q) => quote({ ...q, fee_fixed_usd: 3.29 }));
    assert.equal(acceptsFreeAmount(withFee), false);
  });

  it('un proveedor que empieza a cobrar cae solo, sin tocar código', () => {
    // Esta es la prueba que una lista escrita a mano no pasaría: la regla vive
    // en el dato, así que el cambio de comportamiento llega desde la captura.
    const before = ticker('bitso', 3200);
    assert.equal(acceptsFreeAmount(before), true);

    const after = before.map((q) => quote({ ...q, fee_pct: 0.001 }));
    assert.equal(acceptsFreeAmount(after), false, 'una comisión nueva lo degrada sola');
  });

  it('no decide con una sola observación', () => {
    // Con un bracket no se puede saber si la tasa varía. Afirmar que admite
    // monto libre ahí sería una conclusión sacada de no tener datos.
    assert.equal(acceptsFreeAmount([quote({})]), false);
  });
});

describe('convertir un monto que no es un bracket', () => {
  /**
   * Comisión fija: la tasa efectiva **sube** con el monto porque la comisión se
   * diluye. Medido sobre la ventana: wise y western_union, monótonas en 1.152
   * de 1.152 corridas. Por eso se pueden acotar.
   */
  const withFixedFee = (id: string, rate: number, fee: number) =>
    [1, 100, 500, 1000].map((b) =>
      quote({
        provider_id: id,
        bracket_usd: b,
        gross_rate: rate,
        fee_fixed_usd: fee,
        amount_in: b,
        amount_out: Math.max(0, (b - fee) * rate),
      }),
    );

  /**
   * Un libro de órdenes: a más monto, peor tasa, y **no** de forma monótona en
   * la dirección que haría válida una cota. La forma de binance_p2p.
   */
  const orderBook = (id: string) =>
    [
      [1, 3200],
      [100, 3180],
      [500, 3210],
      [1000, 3150],
    ].map(([b, rate]) =>
      quote({
        provider_id: id,
        bracket_usd: b as number,
        gross_rate: rate as number,
        amount_in: b as number,
        amount_out: (b as number) * (rate as number),
      }),
    );

  const quotes = [
    ...ticker('bitso', 3200),
    ...ticker('buda', 3150),
    ...withFixedFee('wise', 3100, 5),
    ...orderBook('binance_p2p'),
  ];

  it('calcula exacto a quien lo admite, y lo dice', () => {
    const { exact } = convert(quotes, 250, 'usd_to_cop');
    const mine = exact.find((r) => r.quote.provider_id === 'bitso');

    assert.equal(mine?.pesos, 800_000, '250 × 3200');
    assert.equal(mine?.usd, 250, 'la cifra es del monto pedido');
    assert.equal(mine?.exact, true);
  });

  it('a quien cobra comisión lo acota entre dos mediciones, sin interpolar', () => {
    const { bounded } = convert(quotes, 250, 'usd_to_cop');
    const mine = bounded.find((b) => b.quote.provider_id === 'wise');

    assert.ok(mine, 'no desaparece por no poder calcularse exacto');
    assert.equal(mine?.lower.usd, 100, 'el bracket medido por debajo');
    assert.equal(mine?.upper.usd, 500, 'el bracket medido por encima');
    // Los dos extremos son observaciones reales, no un punto inventado.
    assert.equal(mine?.lower.pesos, (100 - 5) * 3100);
    assert.equal(mine?.upper.pesos, (500 - 5) * 3100);
  });

  it('no acota cuando la corrida no es monótona', () => {
    // Un libro de órdenes puede mejorar y empeorar según la profundidad. Una
    // cota apoyada en monotonía que no existe parece información y no lo es.
    const { bounded, measured } = convert(quotes, 250, 'usd_to_cop');
    assert.ok(!bounded.some((b) => b.quote.provider_id === 'binance_p2p'));
    const mine = measured.find((r) => r.quote.provider_id === 'binance_p2p');
    assert.ok(mine, 'cae al bracket medido más cercano');
    assert.equal(mine?.exact, false);
    assert.ok(mine !== undefined && [100, 500].includes(mine.usd));
  });

  it('no acota fuera del rango medido, porque eso sería extrapolar', () => {
    const { bounded, measured } = convert(quotes, 5000, 'usd_to_cop');
    assert.ok(!bounded.some((b) => b.quote.provider_id === 'wise'));
    assert.ok(measured.some((r) => r.quote.provider_id === 'wise'));
  });

  it('las listas van separadas, porque no son comparables entre sí', () => {
    // Ordenar juntas una cifra de 250 USD con otra de 100 sería comparar dos
    // montos como si fueran uno: el Art. III.3 existe por esto.
    const { exact, bounded, measured } = convert(quotes, 250, 'usd_to_cop');
    assert.equal(exact.length, 2, 'bitso y buda');
    assert.equal(bounded.length, 1, 'wise');
    assert.equal(measured.length, 1, 'binance_p2p');
    assert.ok(exact.every((r) => r.exact));
    assert.ok(measured.every((r) => !r.exact));
  });

  it('una comisión de CERO no es una comisión', () => {
    // instarem publica una sola tasa y cobra 0 — medido: un único valor
    // fee_fixed_usd = 0 en 4.608 filas. La primera versión preguntaba si el
    // campo era no-nulo y lo mandaba al grupo aproximado teniendo la respuesta
    // exacta. Es la misma familia de error que confundir "no medido" con cero.
    const free = withFixedFee('instarem', 3100, 0);
    const { exact } = convert(free, 250, 'usd_to_cop');
    const mine = exact.find((r) => r.quote.provider_id === 'instarem');
    assert.equal(mine?.pesos, 250 * 3100);
    assert.equal(mine?.usd, 250);
  });

  it('vendiendo gana quien entrega más pesos', () => {
    const { exact } = convert(quotes, 250, 'usd_to_cop');
    assert.deepEqual(
      exact.map((r) => r.quote.provider_id),
      ['bitso', 'buda'],
    );
  });

  it('comprando gana quien cobra menos, que es el orden inverso', () => {
    const buying = [
      ...ticker('bitso', 3200).map((q) =>
        quote({
          ...q,
          direction: 'cop_to_usd',
          fixed_side: 'out',
          amount_in: q.bracket_usd * 3200,
          amount_out: q.bracket_usd,
        }),
      ),
      ...ticker('buda', 3150).map((q) =>
        quote({
          ...q,
          direction: 'cop_to_usd',
          fixed_side: 'out',
          amount_in: q.bracket_usd * 3150,
          amount_out: q.bracket_usd,
        }),
      ),
    ];
    const { exact } = convert(buying, 250, 'cop_to_usd');
    assert.deepEqual(
      exact.map((r) => r.quote.provider_id),
      ['buda', 'bitso'],
      'pagar 787.500 es mejor que pagar 800.000',
    );
  });

  it('un monto imposible no devuelve nada en vez de devolver cero', () => {
    // Cero pesos es una afirmación; ninguna fila es la ausencia de una.
    for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const { exact, measured } = convert(quotes, bad, 'usd_to_cop');
      assert.equal(exact.length, 0, `monto ${bad}`);
      assert.equal(measured.length, 0, `monto ${bad}`);
    }
  });

  it('un bracket exacto sigue siendo exacto, no aproximado', () => {
    const { exact } = convert(quotes, 500, 'usd_to_cop');
    const mine = exact.find((r) => r.quote.provider_id === 'bitso');
    assert.equal(mine?.pesos, 1_600_000);
    assert.equal(mine?.usd, 500);
  });
});

describe('la decisión de El Dorado rige acá también', () => {
  /**
   * La primera versión agrupaba por proveedor **y método**, así que El Dorado
   * salía con cuatro filas en el conversor mientras la home mostraba una. Una
   * decisión que solo rige donde se escribió no es una decisión.
   */
  const methods = ['bank_bancolombia', 'app_nequi_co', 'app_llave_co', 'app_daviplata_co'];

  // Tres brackets en zigzag: con solo dos, cualquier par es monotono en
  // alguna direccion y el fixture caeria en el grupo acotado por accidente.
  // El eldorado real no es monotono y el fixture tiene que parecerse a eso.
  const bump = (b: number): number => (b === 500 ? 0 : b === 100 ? 40 : 60);

  const eldorado = (direction: LatestQuote['direction']) =>
    methods.flatMap((method, i) =>
      [100, 500, 1000].map((b) =>
        quote({
          provider_id: 'eldorado',
          payment_method: method,
          direction,
          fixed_side: direction === 'usd_to_cop' ? 'in' : 'out',
          bracket_usd: b,
          fee_pct: 0.0099,
          // Tasa distinta por bracket y sin orden: el eldorado real no es
          // monótono, así que cae al bracket medido y no se acota.
          amount_in: direction === 'usd_to_cop' ? b : b * (3000 + i * 10 + bump(b)),
          amount_out: direction === 'usd_to_cop' ? b * (3000 + i * 10 + bump(b)) : b,
        }),
      ),
    );

  it('muestra una sola fila, no cuatro', () => {
    const { measured } = convert(eldorado('usd_to_cop'), 250, 'usd_to_cop');
    assert.equal(measured.filter((r) => r.quote.provider_id === 'eldorado').length, 1);
  });

  it('vendiendo se queda con el método que más paga', () => {
    const { measured } = convert(eldorado('usd_to_cop'), 250, 'usd_to_cop');
    const mine = measured.find((r) => r.quote.provider_id === 'eldorado');
    assert.equal(mine?.quote.payment_method, 'app_daviplata_co', 'el de tasa 3030');
  });

  it('comprando se queda con el que menos cobra, que es el otro extremo', () => {
    const { measured } = convert(eldorado('cop_to_usd'), 250, 'cop_to_usd');
    const mine = measured.find((r) => r.quote.provider_id === 'eldorado');
    assert.equal(mine?.quote.payment_method, 'bank_bancolombia', 'el de tasa 3000');
  });
});
