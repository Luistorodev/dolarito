# Plan técnico — Dolarito

**Ubicación esperada en el repo:** `specs/001-dolarito/plan.md`
**Deriva de:** `spec.md` v1 y `constitution.md` v1.3.0
**Fecha:** 2026-09-12

---

## 1. Decisiones de stack

| Capa | Decisión | Por qué |
|---|---|---|
| Base de datos | Supabase (Postgres) | Series de tiempo + `jsonb` para `raw`, API auto-generada, RLS |
| Ingesta | Scripts TypeScript ejecutados por GitHub Actions | Historial de corridas visible; depurable sin entrar a otra consola |
| Frontend | Astro + islas | El sitio es mayormente contenido; el JS solo se necesita en el selector de bracket |
| Hosting | Vercel | Adapter oficial de Astro, middleware para la contraseña |
| Protección | Middleware con contraseña compartida vía variable de entorno | Quitarla es cambiar una env var, no código (HU-07) |

### 1.1 Por qué Astro y no Next.js

El sitio de la v1 es: un encabezado con la TRM, dos rankings, páginas de
explicación y fichas por proveedor. Eso es un sitio de contenido con una isla
interactiva. Astro entrega menos JavaScript, y el contenido explicativo —que es
buena parte del valor del producto según HU-05— se escribe en Markdown sin
ceremonia.

**Qué invalidaría esta decisión:** si HU-08 (histórico de márgenes por proveedor
con gráficos interactivos) se adelanta a la v1, el peso se mueve hacia una app
con estado y Next.js se vuelve la mejor opción. Mientras HU-08 siga fuera de la
v1, Astro gana.

### 1.2 Advertencia sobre GitHub Actions

Dos limitaciones reales que hay que aceptar conscientemente:

- Los cron de Actions **no son puntuales**. Bajo carga de la plataforma se
  retrasan varios minutos. Con cadencia de 15 minutos el impacto es tolerable y
  queda muy por debajo del umbral de 2 horas de la métrica de continuidad.
- **Los workflows programados se deshabilitan tras 60 días sin actividad en el
  repo.** Es la causa más común de que un tracker "deje de funcionar solo".
  Mitigación: alerta de silencio (§5) más un commit periódico.

**Ruta de migración:** cuando la ingesta esté estable, mover el disparo a
`pg_cron` + Edge Function dentro de Supabase. Es más confiable y elimina ambas
limitaciones, a costa de peor depuración. No hacerlo al principio.

## 2. Esquema de datos

```sql
-- Catálogo. Solo entidades que aparecen en rankings. Las referencias NO son
-- proveedores: viven en `runs`.
create table providers (
  id        text primary key,     -- 'eldorado', 'dolarapp', 'binance_p2p'
  name      text not null,
  mode      text not null check (mode in ('local','remesa')),
  asset     text not null check (asset in ('usd','usdt','usdc')),
  channel   text not null check (channel in ('exchange','p2p','bank_transfer','fintech')),
  site_url  text,
  notes     text
);

-- Una fila por corrida. Observabilidad + referencias del instante.
create table runs (
  id              uuid primary key default gen_random_uuid(),
  started_at      timestamptz not null default now(),
  finished_at     timestamptz,
  trm             numeric(14,4),
  trm_from        date,                     -- vigenciadesde
  trm_to          date,                     -- vigenciahasta (cubre fines de semana)
  mid_market      numeric(14,4),
  mid_market_src  text check (mid_market_src in ('yahoo','er_api')),
  mid_market_at   timestamptz,              -- momento del dato, no de la captura
  sources_ok      text[]  not null default '{}',
  sources_failed  jsonb   not null default '{}'
);

-- La tabla central. Solo observaciones reales: un fallo de red NO escribe acá.
create table quotes (
  id              bigserial primary key,
  run_id          uuid not null references runs(id) on delete cascade,
  provider_id     text not null references providers(id),

  mode            text not null check (mode in ('local','remesa')),
  asset           text not null check (asset in ('usd','usdt','usdc')),
  channel         text not null check (channel in ('exchange','p2p','bank_transfer','fintech')),
  direction       text not null check (direction in ('cop_to_usd','usd_to_cop')),
  bracket_usd     numeric not null check (bracket_usd in (1,100,500,1000)),
  payment_method  text,

  -- El lado fijo siempre está denominado en USD y equivale a bracket_usd.
  fixed_side      text not null check (fixed_side in ('in','out')),
  amount_in       numeric(18,4),   -- lo que la persona entrega
  currency_in     text check (currency_in in ('COP','USD')),
  amount_out      numeric(18,4),   -- lo que la persona recibe
  currency_out    text check (currency_out in ('COP','USD')),

  status          text not null check (status in ('ok','out_of_range')),
  limit_reason    text check (limit_reason in ('below_minimum','above_maximum','insufficient_liquidity')),

  gross_rate      numeric(14,4),
  fee_pct         numeric(8,6),
  fee_fixed_usd   numeric(12,4),
  fee_amount_usd  numeric(12,4),   -- comisión absoluta cuando la fuente la da
  amounts_source  text not null check (amounts_source in ('provider','computed')),
  eta_minutes     integer,

  raw             jsonb not null,
  captured_at     timestamptz not null
);

create unique index on quotes
  (run_id, provider_id, direction, bracket_usd, coalesce(payment_method,''));
create index on quotes (provider_id, direction, bracket_usd, captured_at desc);
create index on quotes (mode, direction, bracket_usd, status, captured_at desc);

-- Histórico de mercado sembrado de una vez. Nunca se mezcla con las capturas.
create table market_history (
  d          date primary key,
  close      numeric(14,4) not null,
  src        text not null default 'yahoo_seed',
  loaded_at  timestamptz not null default now()   -- cuándo se trajo la fila
);
```

### 2.1 Notas sobre el esquema

**El lado fijo siempre es USD.** `bracket_usd` denomina el lado fijo de la
operación, y `fixed_side` dice cuál es:

| Dirección | `fixed_side` | Fijo | Varía | Ranking |
|---|---|---|---|---|
| `usd_to_cop` | `in` | entrego N USD | recibo COP | `amount_out` DESC |
| `cop_to_usd` | `out` | quiero N USD | pago COP | `amount_in` ASC |

Esto resuelve la ambigüedad de comparar "100 USD" en la dirección de compra: no
es "gasto el equivalente a 100 USD en pesos" (que dependería de una tasa de
conversión no especificada y variable entre corridas), sino "quiero terminar con
100 USD". El lado fijo es idéntico para todos los proveedores, que es la única
forma de que la comparación sea válida.

**`status` solo admite observaciones reales.** Un fallo de red, un timeout o una
respuesta corrupta **no generan fila**: se registran en `runs.sources_failed`
(Artículo I.2, corolario). `out_of_range` sí es una observación —sabemos que el
proveedor no opera a ese monto y tenemos su respuesta cruda— y por eso escribe,
con el motivo en `limit_reason`. Esta separación es la que permite que la alerta
de silencio de T019 funcione: ausencia de filas significa realmente ausencia.

**`amounts_source` protege la honestidad del cálculo.** Cuando la fuente entrega
el monto final (Eldorado, Wise), se usa el suyo y se marca `provider`. Cuando
solo da tasa y comisiones (Bitso, Buda, DolarApp), se calcula con la función
compartida y se marca `computed`. Nunca se recalcula un monto que la fuente ya
dio: su fórmula interna es la verdad para esa fuente.

**`asset` y `channel` reemplazan a `rail`.** Una sola columna no podía expresar
que Binance P2P es p2p sobre USDT. Separarlas también hace explícito que el modo
Local es íntegramente stablecoin, que la interfaz debe comunicar.

**`market_history.loaded_at` separa el día del dato de la carga.** `d` es el
día de cierre que la fila describe; `loaded_at` es cuándo lo trajimos. Sin esa
segunda marca no hay forma de distinguir una siembra vieja de una resiembra, ni
de auditar qué corrida de carga produjo qué filas, que es lo que pide el
Artículo I.3. Es la única tabla donde ambas fechas difieren: en `quotes` y
`runs` la captura *es* el evento.

**`raw` es `not null`.** Coherente con lo anterior: solo escriben las
observaciones, y toda observación tiene respuesta cruda.

**No hay `UPDATE` en `quotes`.** Solo inserciones. El índice único impide que una
corrida repetida duplique filas, que sería incorregible.

**`undefined` en el adapter, `null` en la base.** El adapter TypeScript omite el
campo; la capa de persistencia lo traduce a `null`.

### 2.2 Vista de lectura

```sql
create view latest_quotes as
select distinct on (provider_id, direction, bracket_usd, coalesce(payment_method,''))
       q.*, r.trm, r.mid_market, r.mid_market_at,
       (r.trm        - q.gross_rate) / nullif(r.trm,0)        as markup_vs_trm,
       (r.mid_market - q.gross_rate) / nullif(r.mid_market,0) as markup_vs_mid
from quotes q join runs r on r.id = q.run_id
where q.captured_at > now() - interval '24 hours'
order by provider_id, direction, bracket_usd, coalesce(payment_method,''),
         q.captured_at desc;
```

El corte de 24 horas es deliberado: sin él, un proveedor caído hace tres semanas
seguiría apareciendo como "el último dato". Ausencia en esta vista significa
ausencia real, y la interfaz la muestra como tal (HU-06).

Se exponen **dos márgenes**, no uno, porque responden preguntas distintas
(Artículo III.5):

- `markup_vs_trm` — legible para el usuario. Es la comparación que la gente
  busca. Se muestra en la UI.
- `markup_vs_mid` — contra la tasa media en vivo. Es la métrica analítica y el
  cimiento de HU-08. **No usar la TRM acá**: se calcula con las operaciones del
  día hábil anterior, así que está desfasada un día completo incluso entre
  semana.

Ninguno de los dos se persiste: son derivables, y persistirlos crearía dos
fuentes de verdad.

### 2.3 RLS

Durante la fase privada **no hay lectura pública**. HU-07 exige que todo el
contenido quede tras la contraseña, y una política de lectura pública con la
`anon key` en el navegador permitiría consultar la API de Supabase sin pasar por
el middleware, dejando la protección en nada.

- `quotes`, `runs`, `providers`: RLS activo, **sin** política de lectura anónima.
- Todo acceso de lectura ocurre en el servidor (Astro SSR) con clave de servidor.
  Ninguna clave llega al navegador.
- Escritura: solo con la `service_role key`, en los secretos del workflow.

**Consecuencia de diseño para T021:** el selector de bracket no puede consultar
la base desde el cliente. El servidor envía las cotizaciones de los cuatro
brackets en la carga inicial —son unas 64 filas, trivial— y el filtrado ocurre en
el cliente sobre datos ya entregados.

## 3. Contrato del adapter

Todo adapter exporta una función con esta firma. El orquestador no conoce
ninguna otra cosa sobre él.

```ts
export type Money = { amount: number; currency: 'COP' | 'USD' };

/** Lo que todo quote lleva, haya salido como haya salido. */
type QuoteCommon = {
  provider_id: string;
  mode: 'local' | 'remesa';
  asset: 'usd' | 'usdt' | 'usdc';
  channel: 'exchange' | 'p2p' | 'bank_transfer' | 'fintech';
  direction: 'cop_to_usd' | 'usd_to_cop';
  bracket_usd: 1 | 100 | 500 | 1000;
  payment_method?: string;

  fixed_side: 'in' | 'out';

  gross_rate?: number;
  fee_pct?: number;
  fee_fixed_usd?: number;
  fee_amount_usd?: number;
  amounts_source: 'provider' | 'computed';
  eta_minutes?: number;

  raw: unknown;
  captured_at: string;        // ISO 8601
};

/** Observación real: el proveedor cotizó y ambos lados se conocen. */
type QuoteOk = QuoteCommon & {
  status: 'ok';
  in: Money;                  // lo que la persona entrega
  out: Money;                 // lo que la persona recibe
  limit_reason?: never;       // no hay límite que reportar en un quote que salió
};

/** También observación real: sabemos que no opera a ese monto, y tenemos su crudo. */
type QuoteOutOfRange = QuoteCommon & {
  status: 'out_of_range';
  limit_reason: 'below_minimum' | 'above_maximum' | 'insufficient_liquidity';
  in?: Money;                 // el proveedor nunca los cotizó
  out?: Money;
};

export type Quote = QuoteOk | QuoteOutOfRange;

export type Reference = {
  kind: 'trm' | 'mid_market';
  value: number;
  source: string;             // 'datos_gov' | 'yahoo' | 'er_api'
  valid_from?: string;
  valid_to?: string;
  observed_at?: string;       // momento del dato, no de la captura
  raw: unknown;
};

export interface QuoteAdapter {
  id: string;
  kind: 'quote';
  mode: 'local' | 'remesa';
  providerIds: string[];      // wise declara tres; el resto, uno
  fetchQuotes(brackets: number[]): Promise<Quote[]>;
}

export interface ReferenceAdapter {
  id: string;
  kind: 'reference';
  fetchReference(): Promise<Reference>;
}

export type Adapter = QuoteAdapter | ReferenceAdapter;
```

**Por qué `QuoteAdapter` declara `providerIds` y no solo un `id`.** Un adapter
no es un proveedor. `wise` es **una** llamada que devuelve Wise, Instarem y
Western Union: seis adapters cubren ocho proveedores.

La consecuencia es sobre la métrica de cobertura. Contar adapters mide *nuestro
código*; contar proveedores mide *lo que el usuario pierde*. Una caída de `wise`
apaga tres de los ocho nombres del ranking mientras parece una sola fuente
callándose. La unidad correcta es el proveedor que el usuario no puede ver, y
`providerIds` es lo que permite sumarlos sin que el orquestador tenga que saber
nada sobre qué adapter cubre qué.

**Por qué `Quote` es una unión y no un tipo plano.** Con `in?` y `out?`
opcionales, un quote que dice `status: 'ok'` sin montos es una forma válida para
el compilador. Esa forma escribiría una fila afirmando una observación que nunca
hicimos, que es exactamente lo que el Artículo I prohíbe. La unión discriminada
por `status` la vuelve irrepresentable en vez de meramente desaconsejada, y el
estrechamiento por `status` da acceso a `in` y `out` sin cast.

**Por qué el tipo es más estricto que el esquema.** En `quotes` (§2) las cuatro
columnas `amount_*` y `limit_reason` son nulables, y el tipo de acá no lo
permite en las combinaciones de arriba. No es una contradicción: son dos
controles con alcances distintos.

- El **esquema** es la última línea y tiene que admitir todo lo que legítimamente
  llegue por cualquier vía, incluidas correcciones manuales y cargas históricas.
  Un CHECK entre columnas que exigiera `amount_in is not null when status='ok'`
  sería posible, pero rechazaría la fila **después** de la corrida, cuando ya no
  hay a quién preguntarle y la fuente ya respondió.
- El **tipo** ataja la misma clase de error en el único punto donde todavía se
  puede corregir barato: al escribir el adapter, antes de que exista una corrida.

El precio de la asimetría es que la capa de persistencia sigue siendo
responsable de traducir `undefined` a `null` (§2.1). La ganancia es que ningún
adapter puede *construir* la forma prohibida, así que esa traducción nunca
recibe una fila incoherente.

**`limit_reason` obligatorio en `out_of_range`** es la otra estrechez, y sale de
§2.1: `out_of_range` escribe "con el motivo en `limit_reason`". Una fila que
dice que el proveedor no opera a ese monto pero no dice por qué no es accionable
—no distingue un mínimo de un techo ni de falta de liquidez, que es justo lo que
T015 y T016 necesitan reportar—. El esquema la aceptaría; el tipo no.

### 3.1 Función única de montos

`computeAmounts()` es la **única** implementación autorizada para derivar montos
a partir de tasa y comisiones. Ningún adapter calcula por su cuenta.

```ts
export function computeAmounts(input: {
  direction: 'cop_to_usd' | 'usd_to_cop';
  bracket_usd: number;
  gross_rate: number;          // COP por unidad de activo
  fee_pct?: number;            // fracción, ej. 0.0099
  fee_fixed_usd?: number;
}): { in: Money; out: Money; fixed_side: 'in' | 'out' };
```

**Orden canónico de aplicación**, idéntico en ambas direcciones: las comisiones
se aplican siempre sobre el lado en USD, primero la porcentual y después la
fija, y la conversión a COP ocurre al final con `gross_rate`. Este orden es una
convención del proyecto, no una verdad universal — y por eso **cuando la fuente
entrega el monto final, el suyo manda** y se marca `amounts_source: 'provider'`.

Requisito: tests dorados con al menos un caso por dirección, verificados a mano,
antes de escribir ningún adapter que dependa de la función.

**Reglas que todo adapter cumple:****Reglas que todo adapter cumple:**

1. Si un bracket queda fuera de los límites del proveedor, devuelve la fila con
   `status: 'out_of_range'` y su `limit_reason`. Si la **consulta** falla
   (timeout, 5xx, respuesta corrupta), **no devuelve fila**: lanza, y el
   orquestador lo registra en `runs.sources_failed` (Artículo I.2).
2. Nunca infiere un campo ausente. `undefined` es una respuesta válida.
3. No escribe en la base. Solo traduce. La persistencia es del orquestador.
4. Usa el cliente HTTP compartido. No llama a `fetch` directamente: el
   User-Agent, el timeout y el backoff están centralizados ahí.
5. Tiene un test con una respuesta real guardada en `fixtures/`.

### 3.1 Notas por fuente

| Adapter | Particularidad |
|---|---|
| `eldorado` | Un POST por bracket **y por método de pago**. Es el único que multiplica filas por método. Usa `fixedSide` y `amountIn`/`amountOut`, que mapean directo a nuestro contrato. `fees.total[].rate` es la fracción (→ `fee_pct`); `fees.total[].value` es el monto absoluto (→ `fee_amount_usd`). **No confundirlos.** `amounts_source: 'provider'`. Mínimo de 5 USD. |
| `dolarapp` | `ask`/`bid` directos, sin comisión explícita: va dentro del precio. `fee_*` queda `undefined`. |
| `binance_p2p` | No tiene precio único. Calcula el **precio ponderado por volumen** para el bracket, recorriendo los anuncios hasta cubrir el monto. Guarda el top 10 completo en `raw`. Dos llamadas: `BUY` y `SELL`. |
| `bitso` | `ask`/`bid` del ticker. Spread estrecho, alta liquidez. |
| `buda` | `min_ask`/`max_bid`. **Libro delgado en COP**: spread mucho más ancho. Se incluye, marcado. |
| `wise` | Una llamada por bracket devuelve los tres proveedores de remesa. Produce 3 filas. `fee` (absoluto, USD) viene aparte de `rate`; `receivedAmount` es el monto final → `amounts_source: 'provider'`. |
| `trm` | Referencia. Escribe en `runs`. Endpoint: `https://www.datos.gov.co/resource/32sa-8pi3.json?$limit=1&$order=vigenciadesde DESC`. Devuelve `valor`, `vigenciadesde`, `vigenciahasta`. **Usar `vigenciahasta`** para saber hasta cuándo rige: resuelve fines de semana y festivos sin calcular calendario. |
| `mid_market` | Referencia. Escribe en `runs`. Crítico para HU-08. Primaria: Yahoo Finance `USDCOP=X` (`query1.finance.yahoo.com/v8/finance/chart/`), granularidad hasta 1 minuto. Respaldo: `open.er-api.com` (diaria). Registrar siempre cuál respondió en `mid_market_src`. |

## 4. Estructura del repo

```
dolarito/
├── .specify/memory/constitution.md
├── specs/001-dolarito/{spec,plan,tasks}.md
├── .github/workflows/ingest.yml          # cron */15
├── packages/ingest/
│   ├── src/
│   │   ├── adapters/{eldorado,dolarapp,binance-p2p,bitso,buda,wise}.ts
│   │   ├── references/{trm,mid-market}.ts
│   │   ├── contract.ts                   # tipos Quote, Reference, Adapter
│   │   ├── money.ts                      # computeAmounts(), fuente única
│   │   ├── http.ts                       # cliente compartido: UA, timeout, backoff
│   │   ├── registry.ts                   # array de adapters activos
│   │   ├── orchestrator.ts               # allSettled + persistencia
│   │   └── db.ts
│   └── fixtures/                         # respuestas reales para tests
├── supabase/migrations/
└── apps/web/                             # Astro
    └── src/{pages,components,content}/
```

## 5. Observabilidad

- Cada corrida inserta una fila en `runs` con `sources_ok` y `sources_failed`.
- **Alerta de silencio:** un job diario consulta si alguna fuente lleva más de 6
  horas sin una fila. Si la hay, falla ruidosamente.
- Regla del Artículo VI: si una fuente no respondió, **no** se reescribe su
  último valor. El hueco queda.

### 5.1 Cuándo la corrida sale en rojo

El orquestador termina con código distinto de cero si ocurre **cualquiera** de
estas tres, para que Actions lo marque:

1. **Se perdieron más de 4 de los 8 proveedores.**
2. **Algún modo quedó sin ningún proveedor.**
3. **Falló cualquiera de las 2 referencias.** Su ausencia es incidente, no
   degradación: sin TRM ni tasa media no hay con qué comparar, y los márgenes de
   `latest_quotes` quedan nulos para toda la corrida.

**La unidad es el proveedor perdido, no el adapter caído.** Seis adapters cubren
ocho proveedores, porque `wise` es una llamada que devuelve Wise, Instarem y
Western Union. Contar adapters mide nuestro código; contar proveedores mide lo
que el usuario deja de ver. Por eso `QuoteAdapter` declara `providerIds` (§3):
el orquestador suma los proveedores de los adapters que fallaron sin tener que
saber qué adapter cubre a quién.

**Por qué la regla 2 existe aparte de la 1.** La 1 sola no alcanza, y el caso que
lo demuestra es Wise. Su caída pierde 3 proveedores —no supera 4, así que la
regla 1 calla— pero esos 3 son *todo* el modo Remesa. Para quien vino a comparar
una remesa, un modo vacío es indistinguible de que el sistema no exista: no ve un
ranking incompleto, no ve ninguno.

Eso es cualitativamente distinto de perder la misma cantidad de proveedores
repartidos. Cuatro fuentes locales caídas dejan 4 proveedores perdidos y los dos
rankings todavía sirven: con menos opciones, pero respondiendo la pregunta que el
usuario hizo. Un conteo no distingue esos dos casos porque trata a los ocho
proveedores como intercambiables, y no lo son: pertenecen a dos productos que se
consultan por separado.

De ahí que la regla 1 se quede en "más de la mitad" en vez de bajarse hasta que
Wise quepa. Bajar el umbral a 3 haría saltar la alarma con cualquier tríada de
fuentes caídas, que es ruido; la regla 2 ataca el caso concreto por su causa
real, que es la cobertura de un modo, no la cantidad.

## 6. Orden de construcción

1. Migraciones y catálogo de proveedores.
2. `contract.ts`, `money.ts` (con tests dorados), `http.ts`, y el orquestador
   con un adapter falso.
3. Adapters de referencia (TRM, mid-market) — son los más simples y los que
   habilitan todo lo demás.
4. `bitso` — el adapter más simple, valida el contrato de punta a punta.
5. `dolarapp`, `buda`.
6. `eldorado` — introduce la dimensión de método de pago.
7. `binance_p2p` — introduce el cálculo ponderado.
8. `wise` — introduce el modo Remesa.
9. Workflow de Actions + secretos.
10. **Dejar correr 7 días antes de tocar el frontend** (Artículo VI.3).
11. Astro: layout, TRM, rankings, contraseña.
12. Contenido: explicación de TRM, fichas de proveedores.

## 7. Riesgos

| Riesgo | Mitigación |
|---|---|
| Un adapter cambia de formato en silencio | Test con fixture + alerta de silencio |
| Actions se deshabilita por inactividad | Alerta de silencio + migrar a `pg_cron` |
| Binance bloquea por IP | Backoff exponencial y reducción de cadencia. Si el bloqueo persiste, la fuente sale del alcance. **Prohibido rotar IPs o suplantar clientes** (Artículo V.6). |
| Datos de Wise desfasados | Se marcan como estimaciones (HU-03) |
| El bracket de 1 USD se ve vacío | Es intencional y está documentado en la UI |

## 8. Pendientes

- `[NECESITA DECISIÓN]` Dominio. Bloquea el paso 9 (deploy). **Único pendiente
  abierto del proyecto.**
- `[RESUELTO]` Referencias: se guardan **ambas**. La TRM como referencia de cara
  al usuario, y una tasa media de mercado en vivo como base de los cálculos de
  margen. Ver Artículo III.5.
- `[RESUELTO]` Fuente de `mid_market`: **Yahoo Finance `USDCOP=X`** como primaria,
  `open.er-api.com` como respaldo. Razón: la TRM está desfasada un día hábil
  completo incluso entre semana, porque se calcula con las operaciones del día
  anterior. Yahoo refleja el mercado spot en vivo con granularidad de minutos.
  Ambas fuentes quedan congeladas cuando el mercado FX global cierra (viernes
  tarde a domingo tarde); eso es correcto y deseable: el margen medido contra el
  cierre del viernes es precisamente la prima de riesgo de operar sin mercado,
  que es lo que HU-08 busca medir.
  *Riesgo aceptado:* el endpoint de Yahoo no está documentado oficialmente y
  puede cambiar. Por eso el respaldo y la columna `mid_market_src`.
- `[RESUELTO]` Constitution enmendado a v1.3.0. v1.1.0 tocó III.1 y III.5;
  v1.2.0, III.1, el corolario de I.2 y V.6; v1.3.0 acotó el alcance de "cruda"
  en I.2 tras verificar la persistencia contra la base real.
