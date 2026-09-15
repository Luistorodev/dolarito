# Plan técnico — Dolarito

**Ubicación esperada en el repo:** `specs/001-dolarito/plan.md`
**Deriva de:** `spec.md` v1 y `constitution.md` v1.4.0
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

#### El cron salió de los minutos redondos (2026-09-14)

`*/15` dispara en **:00, :15, :30 y :45** — los cuatro minutos más contendidos
del reloj, porque es donde programa todo el mundo. Ahora es
**`7,22,37,52 * * * *`**: los intervalos siguen siendo de 15 minutos exactos,
incluido el salto de hora (52 → 07). **Lo único que cambia es la fase, no la
cadencia**, así que el Artículo V.3 queda donde estaba. `silence.yml` pasó de
`0 13` a `38 13` por lo mismo.

**Esto es una hipótesis, no una causa confirmada, y conviene que quede escrito
así.** El síntoma: el schedule de ingest disparó una vez el 2026-09-13 — falló
por el bump a `@v5`, ver `tasks.md` T018 — y después dejó de correr durante
horas. Lo que **sí** quedó descartado con evidencia, revisando el repositorio:

| Descartado | Cómo |
|---|---|
| Sintaxis del `cron:` | `*/15 * * * *` parsea bien, cinco campos, UTC |
| `on:` mal anidado | Parsea a `{schedule: [...], workflow_dispatch: None}` |
| Un commit reciente lo rompió | El bloque `on:` es idéntico en los 4 commits que tocaron el archivo |
| Rama equivocada | `origin/HEAD → 001-dolarito`, y las dos ramas al día |
| Workflow deshabilitado | Si lo estuviera, el disparo manual tampoco andaría — y anda |
| Facturación o permisos de Actions | Por lo mismo: las manuales corren y terminan |

Lo que **no** se puede ver desde el repositorio es el planificador de GitHub.
Sin esa vista, "lo descarta por carga" y "el schedule se cayó" se ven igual, que
es justo la clase de ambigüedad que este proyecto no acepta dejar abierta.

#### Criterio de decisión — escrito por adelantado, para ejecutar sin deliberar

**Si pasan 2 horas desde el push de este cambio sin ninguna corrida programada,
la hipótesis de los minutos contendidos queda descartada y se activa la ruta a
`pg_cron` de arriba.** Sin volver a discutirlo.

Concreto: push `96918c5` el **2026-09-14T03:58Z**, así que **el plazo vence el
2026-09-14T05:58Z**.

- **2 horas** son 8 disparos esperados a esta cadencia. Que fallen los ocho no es
  retraso de plataforma: es que el schedule no está corriendo.
- **El umbral coincide con el de continuidad** que ya usa esta misma sección, así
  que no introduce un número nuevo que después haya que justificar aparte.
- **Quién lo mide:** `pnpm check:silence`, que desde el 2026-09-14 reporta el
  hueco abierto (T019). No hace falta mirar la UI de Actions: si el chequeo dice
  `it is down right now` con más de 120 minutos, el criterio se cumplió.
- **Lo que NO cuenta como refutación:** una corrida manual. El disparo manual ya
  se sabe que funciona y no dice nada sobre el planificador — fue exactamente
  esa confusión la que dejó pasar el bump a `@v5`.

Si el criterio se cumple, `pg_cron` deja de ser "cuando la ingesta esté estable"
y pasa a ser la tarea siguiente: **la ingesta no puede estabilizarse si su
disparador no corre**, y T020 no acumula nada mientras tanto.

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

**`market_history` no tiene `raw`, y es una decisión, no un olvido.** La
diferencia no es de rigor sino de naturaleza: `quotes` guarda lo que *esta*
corrida observó, y el Artículo I.2 exige el crudo porque sin él no se pueden
recalcular métricas nuevas sobre datos viejos ni auditar qué respondió cada
fuente en cada ciclo. `market_history` es otra cosa — **contexto sembrado de una
vez**, una serie que existía antes que el proyecto y que no se vuelve a consultar
por ciclo. No hay "qué respondió esta corrida" que preservar, porque no hay
corrida: hay una carga.

Guardar el crudo igual costaría una copia de la respuesta completa repetida en
cada una de las ~500 filas que salen de una sola llamada, para preservar un
contexto idéntico quinientas veces. **El crudo se preserva donde corresponde: en
el fixture de la siembra**, versionado en `fixtures/`, que es un archivo por
carga y no una columna por fila.

La consecuencia se acepta con los ojos abiertos: si la serie hay que
reinterpretarla algún día —otra convención de fecha, otro campo de la respuesta—
la fuente de verdad es ese fixture más una resiembra, y `loaded_at` es lo que
permite distinguirla de la anterior. Para `quotes` esa salida no existe, y por
eso ahí `raw` sí es obligatorio.

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

#### ⚠️ Los dos márgenes están mal calculados — decisión tomada, implementación pendiente

**Decidido en dirección el 2026-09-13; se implementa al cerrar T020 (2026-09-20).**
La espera no es para volver a decidir: es para medir con una semana de datos
cuánto se separan las cifras antes y después. Lo que sigue es el cambio a
aplicar, no un menú de opciones.

Hay **dos defectos independientes**, encontrados leyendo el primer ranking real.

**Defecto 1 — se compara contra la tasa anunciada, que el Art. III.1 prohíbe.**
`gross_rate` es lo que el proveedor publica; no incluye la comisión fija. Afecta
a los tres que la cobran. Medido, vendiendo 100 USD:

| Proveedor | `gross_rate` | fee USD | margen actual | tasa efectiva | puesto real |
|---|---|---|---|---|---|
| wise | 3087,23 | 9,16 | **−0,0049** | 2804,44 | **11 de 11** |
| western_union | 2971,71 | 1,99 | 0,0327 | 2912,58 | 10 |

Wise muestra el mejor margen de los once y entrega el peor monto, en la misma
fila.

**Defecto 2 — el signo está invertido en `cop_to_usd`, y este afecta a los ocho.**
La fórmula actual es la misma para las dos direcciones, pero en una se **reciben**
pesos (más es mejor) y en la otra se **pagan** (menos es mejor). Comprando 100 USD
en DolarApp se pagan 319.426 COP —un 4% por encima de la TRM— y la columna
informa **−0,0397**, que se lee como descuento. Es la mitad de las filas de cada
proveedor.

**La corrección.** El margen se calcula desde el **monto efectivo**, nunca desde
`gross_rate`, y el signo se define para que **positivo signifique siempre peor que
la referencia**:

```sql
-- Pesos por dólar realmente pagados o recibidos, esté el COP en el lado que esté.
case when currency_out = 'COP' then amount_out / nullif(amount_in, 0)
     else                           amount_in  / nullif(amount_out, 0)
end as effective_rate

-- Positivo = peor que la referencia, en ambas direcciones.
case when direction = 'usd_to_cop' then (ref - effective_rate) / nullif(ref, 0)
     else                               (effective_rate - ref) / nullif(ref, 0)
end
```

aplicado igual con `trm` y con `mid_market` como `ref`.

**Se sigue exponiendo un solo par de márgenes, no cuatro.** Dos columnas
etiquetadas —"contra la tasa anunciada" y "contra la efectiva"— obligarían al
usuario a entender por qué hay dos, y el Art. III.1 ya zanjó que la anunciada no
es base válida de comparación. Si no es base válida, no se muestra.

Nota: para los cinco proveedores sin comisión fija, `effective_rate` coincide con
`gross_rate`, así que el defecto 1 no los mueve. El defecto 2 sí.

### 2.3 RLS

Durante la fase privada **no hay lectura pública**. HU-07 exige que todo el
contenido quede tras la contraseña, y una política de lectura pública con la
`anon key` en el navegador permitiría consultar la API de Supabase sin pasar por
el middleware, dejando la protección en nada.

- `quotes`, `runs`, `providers`: RLS activo, **sin** política de lectura anónima.
- Todo acceso de lectura ocurre en el servidor (Astro SSR) con clave de servidor.
  Ninguna clave llega al navegador.
- Escritura: solo con la `service_role key`, en los secretos del workflow.

#### N4 — RIESGO ACEPTADO: el tier web lee con `service_role`

**Esto no es una decisión resuelta. Es un riesgo que se asume a sabiendas**,
porque hoy no hay forma de evitarlo con la plataforma que usamos.

Verificado el 2026-09-14: el formulario de *Create new secret API key* del
dashboard de Supabase solo pide **Name** y **Description**. No permite asociar
una llave a un rol de Postgres, y el propio texto advierte que **todas las secret
keys dan acceso elevado y saltan RLS**.

**Qué significa, sin suavizarlo.** El tier web va a leer con `service_role`, que
además de leer **escribe, borra y hace DDL**. Un servidor web comprometido —o un
bug que filtre la variable de entorno— podría **vaciar `quotes`**. El histórico
es lo único irrecuperable de este proyecto: los precios de un momento que ya
pasó no se pueden volver a capturar de ninguna fuente. Todo lo demás se
reconstruye; eso no.

Es desproporcionado y lo sabemos: una página que únicamente hace `SELECT` va a
tener la llave que puede destruir el activo central.

**El rol `web_reader` queda creado y documentado como preparación**, no como algo
en uso. Concede `SELECT` sobre `latest_quotes`, `providers` y `market_history` y
nada más. Hoy está inerte, porque ninguna llave puede asumirlo. Se activa si
ocurre **cualquiera** de estas dos:

1. **Supabase permite asociar llaves a roles.** Sería cambiar el valor de
   `SUPABASE_SERVER_READ_KEY` y nada más: el rol, los grants y las políticas ya
   están.
2. **El acceso pasa a Postgres directo en vez de PostgREST.** Una conexión
   normal sí puede autenticarse como `web_reader`, y ahí el rol funciona tal
   como está escrito. Tiene costo —pool de conexiones desde funciones
   serverless— y por eso no se hace ahora, pero es la salida que no depende de
   que Supabase cambie nada.

**Dos mitigaciones que sí están a nuestro alcance hoy. Evaluarlas en T021:**

- **Que el servidor solo consulte `latest_quotes`.** No elimina el riesgo —la
  llave sigue pudiendo todo— pero reduce la superficie a un único punto de
  acceso, fácil de auditar de un vistazo. Si mañana aparece una consulta a
  `quotes` en el código del tier web, se ve en una revisión.
- **Que la llave viva únicamente en variables de entorno del hosting.** Nunca en
  el repositorio, nunca en un archivo de configuración versionado, nunca en el
  bundle del cliente. Con `.gitignore` ya cubriendo `.env`, lo que falta es la
  disciplina en el despliegue.

Ninguna de las dos convierte esto en resuelto. Acotan el daño; no lo evitan.

**Consecuencia de diseño para T021:** el selector de bracket no puede consultar
la base desde el cliente. El servidor envía las cotizaciones de los cuatro
brackets en la carga inicial y el filtrado ocurre en el cliente sobre datos ya
entregados. **Medido en la primera corrida real (2026-09-13): 74 filas**, no las
"unas 64" que este documento estimaba — la diferencia es Eldorado, que multiplica
por método de pago y aporta 32 él solo. Sigue siendo trivial de enviar.

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

**Orden canónico de aplicación:** las comisiones se aplican siempre sobre el lado
en USD, primero la porcentual y después la fija, y la conversión a COP ocurre al
final con `gross_rate`.

**En `cop_to_usd` esa cadena corre al revés, y el orden inverso importa.** Para
terminar con N dólares hay que **sumar la comisión fija primero y dividir por la
porcentual después** — `(bracket + fija) / (1 − pct)` —, no al revés. Hacerlo en
orden directo subestima lo que la persona paga, y la diferencia es
`fija × pct × rate`: chica, silenciosa, y suficiente para reordenar un ranking.
Los casos dorados E y F de T006b la fijan en las dos direcciones, y una mutación
que invierta cualquiera de las dos hace fallar exactamente el caso de esa
dirección. Este orden es una
convención del proyecto, no una verdad universal — y por eso **cuando la fuente
entrega el monto final, el suyo manda** y se marca `amounts_source: 'provider'`.

Requisito: tests dorados con al menos un caso por dirección, verificados a mano,
antes de escribir ningún adapter que dependa de la función.

**Reglas que todo adapter cumple:**

1. Si un bracket queda fuera de los límites del proveedor, devuelve la fila con
   `status: 'out_of_range'` y su `limit_reason`. Si la **consulta** falla
   (timeout, 5xx, respuesta corrupta), **no devuelve fila**: lanza, y el
   orquestador lo registra en `runs.sources_failed` (Artículo I.2).
2. Nunca infiere un campo ausente. `undefined` es una respuesta válida.
3. No escribe en la base. Solo traduce. La persistencia es del orquestador.
4. Usa el cliente HTTP compartido. No llama a `fetch` directamente: el
   User-Agent, el timeout y el backoff están centralizados ahí.
5. Tiene un test con una respuesta real guardada en `fixtures/`.
6. **Si cotiza las dos direcciones desde un libro único, comprar cuesta más de
   lo que rinde vender.** Ver abajo: aserción por valor, obligatoria para
   `bitso`, `buda`, `dolarapp` y `eldorado`. **No aplica a P2P** — ver el final
   de la subsección.

#### La aserción del spread

Para un mismo bracket y un mismo proveedor:

```
amount_in de cop_to_usd   >   amount_out de usd_to_cop
   (pesos que pago             (pesos que recibo
    por N dólares)              por N dólares)
```

Es la única defensa real contra un libro invertido, y **no hay test de estructura
que la sustituya**. Cruzar `ask` y `bid`, o mapear al revés el lado de una API,
produce ocho filas perfectamente bien formadas: los tipos pasan, `fixed_side`
está correcto, las monedas están en su lugar, los montos escalan con el bracket.
Lo único que cambia es que el proveedor aparece mejor de lo que es, en todas las
filas a la vez y por un margen del orden del spread — chico para verse plausible
fila por fila, suficiente para reordenar un ranking. Es exactamente el error que
el Artículo I llama mentira financiera.

La desigualdad es estricta. Igualdad significa spread cero y comisiones cero, que
en la práctica no existe: si aparece, lo más probable es que el adapter esté
usando **la misma tasa para las dos direcciones**, y eso se reporta, no se
acomoda.

**Por qué la regla se limita al libro único, y qué la reemplaza en P2P.**

La regla se escribió mirando exchanges, donde `ask` y `bid` salen del **mismo**
libro y cruzarlos es aritméticamente imposible sin un error. Se generalizó mal:
en P2P los dos lados son **mercados separados**, con contrapartes, mínimos y
métodos de pago distintos. Que se crucen es un estado real del mercado, no un
defecto del adapter.

Medido sobre el fixture del 2026-09-13, bracket 500: vender rinde **1.540.500
COP** y comprar cuesta **1.539.867** — invertido por 633 COP. Los dos números son
correctos. Comprando 500, el anuncio más barato solo tiene capacidad para 204
USDT y el ponderado sube; vendiendo 500, un solo anuncio lo cubre entero. **Es un
dato del mercado y se registra como observación, no como fallo** — a T020 le
interesa con qué frecuencia ocurre.

En P2P la regla 6 se reemplaza por estas, que cubren la misma clase de error:

- **El filtro de mínimos se aplica.** Un anuncio que no acepta el monto no es
  liquidez disponible; contarlo produce un ponderado mejor que el alcanzable, en
  favor del proveedor y en todas las corridas.
- **El mapeo invertido de `tradeType`, anclado por valor y no por nombre de
  campo.** Se pide `BUY` y los anuncios responden `SELL`, porque describen la
  operación desde el lado del anunciante. Ningún nombre de campo protege de
  nada: el test afirma que `cop_to_usd` sale de los números del libro pedido con
  `BUY` y no de los del otro. **Este es el cruce de lados que la regla 6 atrapaba
  en los demás**, y en P2P hay que atraparlo aparte.

**Lo que NO se puede afirmar: que el ponderado sea monótono con el bracket.**
Parece obvio —más monto, más profundo, peor precio— y es falso, porque el
conjunto elegible **crece** con el bracket: montos mayores superan los mínimos de
anuncios mejores. Medido: comprando, 7 elegibles a bracket 100 y 18 a 500, y el
ponderado **baja** de 3082,59 a 3079,73. En P2P un monto chico se castiga por
exclusión de los mejores anuncios, no por profundidad.

#### Notas por fuente

*(Sin numerar a propósito: esta tabla llevaba un `§3.1` que ya usaba la sección
de montos, y renumerar hubiera roto nueve referencias cruzadas en documentos y
código.)*

| Adapter | Particularidad |
|---|---|
| `eldorado` | **Base:** `https://74j6q7lg6a.execute-api.eu-west-1.amazonaws.com/stage/orderbook` — `GET /methods` para los IDs, `POST /public/v2/quote` para cotizar. **La URL faltaba en este documento** hasta 2026-09-13; sin ella el adapter no era implementable, y `api.eldorado.io` lleva a otra cosa: la API de socios, con client credentials y KYC, que el Art. V.2 dejaría fuera del proyecto. Un POST por bracket **y por método de pago**: 11 métodos COP activos, y el precio varía entre ellos de verdad (3098 en Bancolombia contra 3800 en `bank_tx_co`, 22% peor, medido 2026-09-13). Usa `fixedSide` y `amountIn`/`amountOut`, que mapean directo a nuestro contrato. `fees.total[].rate` es la fracción (→ `fee_pct`); `fees.total[].value` es el monto absoluto en USDT (→ `fee_amount_usd`). **No confundirlos: vienen los dos.** `amounts_source: 'provider'`. **Solo se cotizan 4 de los 11 métodos** y **no hay mínimo de 5 USD**: ver §3.2. |
| `dolarapp` | `ask`/`bid` directos, sin comisión explícita: va dentro del precio. `fee_*` queda `undefined`. |
| `binance_p2p` | No tiene precio único. Calcula el **precio ponderado por volumen** para el bracket, recorriendo los anuncios hasta cubrir el monto. Guarda el top 10 completo en `raw`. Dos llamadas: `BUY` y `SELL`. |
| `bitso` | `ask`/`bid` del ticker. Spread estrecho, alta liquidez. |
| `buda` | `min_ask`/`max_bid`. **Libro delgado en COP**: spread mucho más ancho. Se incluye, marcado. |
| `wise` | Una llamada por bracket devuelve **hasta** los tres proveedores de remesa, según cuáles devuelva la API. `fee` (absoluto, USD) viene aparte de `rate`; `receivedAmount` es el monto final → `amounts_source: 'provider'`. **Un proveedor ausente no genera fila** — ver §3.3. |
| `trm` | Referencia. Escribe en `runs`. Endpoint: `https://www.datos.gov.co/resource/32sa-8pi3.json?$limit=1&$order=vigenciadesde%20DESC`. Devuelve `valor`, `vigenciadesde`, `vigenciahasta`. **Usar `vigenciahasta`** para saber hasta cuándo rige: resuelve fines de semana y festivos sin calcular calendario. |
| `mid_market` | Referencia. Escribe en `runs`. Crítico para HU-08. Primaria: Yahoo Finance `USDCOP=X` (`query1.finance.yahoo.com/v8/finance/chart/`), granularidad hasta 1 minuto. Respaldo: `open.er-api.com` (diaria). Registrar siempre cuál respondió en `mid_market_src`. |

### 3.2 Eldorado: lo que la verificación en vivo corrigió

Todo lo de acá se midió contra respuestas reales el 2026-09-13. Dos cosas que
este documento afirmaba **no tenían fuente y resultaron falsas**.

**No hay mínimo de 5 USD.** Era un dato escrito sin verificar. La API cotiza
0,5, 1 y 5 USD con `200` en todos los casos; no rechaza nada. Lo que existe es un
**piso de comisión de 0,49 USDT**, que en montos chicos domina el precio:

| Bracket | COP que se paga por USDT | `fees.total[].rate` |
|---|---|---|
| 0,5 | 6.221 | 0,4900 |
| 1 | 5.215 | 0,3289 |
| 5 | 3.538 | 0,0893 |
| 100 | 3.129 | 0,0099 |

Por lo tanto **el bracket de 1 USD genera fila `ok` con su precio real**, no
`out_of_range`. No está fuera de rango: está caro. Marcarlo `out_of_range`
afirmaría que el proveedor no opera a ese monto, que es falso, y escondería
justo el dato que HU-04 quiere mostrar — el efecto de las comisiones fijas.
Tampoco se agrega una marca propia de "comisión abusiva": fijar ese umbral nos
convertiría en árbitros de qué precio es aceptable, y el `spec.md` §7 dice que
informamos, no recomendamos. 5.215 contra 3.129 lo dice solo.

**Los 4 métodos de pago que se cotizan, y por qué son 4 y no 11.**

```
bank_bancolombia   app_nequi_co   app_daviplata_co   app_llave_co
```

Criterio: concentran el uso real en Colombia. Los otros 7 son cola larga.

**Esta restricción es nuestra, no de la fuente.** Eldorado no publica ningún
límite de tasa: no hay `X-RateLimit-*`, `Retry-After` ni `Cache-Control` en el
`GET /methods` ni en el `POST /public/v2/quote`. La recortamos por costo propio,
no porque nos lo pidan.

El costo es real y por eso se decide en este documento y no en el código. Cada
cotización es un POST que **crea un registro del lado de ellos**: `preview: true`
no lo evita — el `quoteId` se recupera después con
`GET /public/v2/quote/{quoteId}`, y no existe endpoint de solo precio (se
probaron `/rate`, `/price`, `/rates`, `/orderbook`: los cuatro 404).

| Métodos | POST por ciclo | POST por día | Medido |
|---|---|---|---|
| 4 | 32 | ~3.070 | 40 s en serie |
| 11 | 88 | ~8.450 | — |

**Ampliar la lista es una decisión de producto con costo, no una constante que se
toca al pasar.** Y tiene contrapartida medible: entre los 7 descartados hay
precios que difieren de verdad — `bank_tx_co` cotiza 383.800 COP por 100 USDT
contra 312.898 de Bancolombia, un 22% peor. Al dejarlos fuera, el ranking no
muestra esa diferencia. Fue una decisión consciente, no un descuido.

Entre los 4 elegidos el precio tampoco es uniforme, aunque la variación se
concentra: comprando difieren en el bracket de 1 (5.215 contra 4.634) y son
idénticos en 100, 500 y 1000; vendiendo es al revés — iguales en 1 y distintos
en los tres brackets grandes.

**Dos cosas más que el documento no recogía**, ambas en la respuesta y ninguna
representable en el contrato actual:

- **La cotización no es firme.** Trae `slippageTolerancePercent: 2` junto a
  `amountIn.maxIn` al comprar y `amountOut.minOut` al vender. Se persiste el
  `expected`, que es la cotización; el peor caso queda en `raw`. Quien opere
  puede terminar hasta un 2% peor, y eso es más que la diferencia entre varios
  proveedores del ranking.
- **`expiresAt` está a 2 minutos de `createdAt`.** Con cadencia de 15 minutos, la
  fila guardada está vencida 13 de cada 15 minutos. Sigue siendo una observación
  real de lo que valía en su momento — que es lo que `captured_at` dice— pero la
  interfaz no debería presentarla como un precio tomable.

### 3.3 Wise: por qué son "hasta" 12 filas y no 12

**Las 12 filas por corrida eran una suposición sin verificar.** Lo correcto es
*hasta* 12, según qué proveedores devuelva la API. Conteo real observado el
2026-09-13, consistente entre consultas repetidas:

| `sendAmount` | Proveedores devueltos |
|---|---|
| 1 | solo `instarem` |
| 5 | `instarem`, `western-union` |
| 20 | `instarem`, `western-union` |
| 100 / 500 / 1000 | los tres |

Western Union aparece entre 1 y 5; Wise, entre 20 y 100.

**La respuesta no dice por qué falta nadie.** No hay estado, ni motivo, ni
entrada vacía: el proveedor simplemente no está en el array. Por eso un ausente
**no genera fila de ningún tipo**, y en particular no se marca `below_minimum`:
eso afirmaría una causa que la fuente no dio (Art. I.1).

El patrón parece un mínimo, pero este endpoint es una **recolección periódica de
comparaciones, no una cotización en vivo** — cada entrada trae su propio
`dateCollected` —, así que una ausencia puede ser igual de bien un corredor que
no cubren o una pasada de recolección que no completó del lado de ellos. No
sabemos cuál, y el producto no inventa la diferencia.

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
| **Eldorado cierra el acceso por los `quoteId` que nunca se operan** | Ver §7.1. Si ocurre, **Art. V.6: se baja la cadencia o se retira la fuente**. Nunca rotar IPs ni suplantar clientes. |
| **El tier web tiene una llave que puede vaciar `quotes`** | Riesgo aceptado, §2.3. Mitigaciones parciales a evaluar en T021. **Sin resolver mientras Supabase no permita atar llaves a roles.** |
| **La TRM no tiene respaldo: si datos.gov.co no responde, no hay a quién más preguntar** | Ver §7.2. Hoy se detecta por vencimiento, no se sustituye. |

### 7.1 El riesgo de Eldorado, que es distinto de los demás

Los otros siete proveedores se consultan con un `GET` que no deja nada del lado
de ellos. Eldorado no: **cada cotización es un `POST` que crea un registro**, y
`preview: true` no lo evita — el `quoteId` sigue recuperable después. No existe
endpoint de solo precio (§3.2).

Con 4 métodos × 4 brackets × 2 direcciones cada 15 minutos, eso son **~3.072
registros diarios que nunca se convierten en una operación**. Alrededor de un
millón al año, todos `GUEST`, todos vencidos a los dos minutos, ninguno operado.

Es un patrón que desde su lado se ve exactamente como abuso, aunque la intención
sea la contraria y el User-Agent diga quiénes somos y cómo contactarnos
(Art. V.4). **Es el proveedor con más probabilidad de cortarnos el acceso, y el
más justificado en hacerlo.**

La respuesta si pasa ya está decidida y no admite creatividad: bajar la cadencia,
o retirar la fuente del alcance. **Nunca rotar IPs, suplantar clientes ni buscar
rodeos técnicos** (Art. V.6). Una fuente que no nos quiere no entra al producto.

Vale también la vía honesta antes de que pase: escribirles y preguntar. El
contacto del User-Agent existe justamente para que ellos puedan hacerlo primero,
pero nada impide que empecemos nosotros.

### 7.2 La TRM es la única fuente sin red

Descubierto el 2026-09-15, a raíz de un 503 de datos.gov.co que costó la TRM
de una corrida.

**La asimetría, sin suavizarla:**

| Referencia | Primaria | Respaldo |
|---|---|---|
| mid-market | Yahoo `USDCOP=X` | `open.er-api.com`, **ejercido contra la red real** (T011) |
| **TRM** | `datos.gov.co` | **ninguno** |

No es un descuido. La TRM es una cifra **oficial**, y a diferencia de una tasa
de mercado no tiene sustituto legítimo: una media de otra fuente **no es la
TRM**, y servirla como si lo fuera sería exactamente lo que prohíbe el
Artículo I.1. El respaldo que existe para mid-market no tiene equivalente
honesto acá.

**Qué se hizo el 2026-09-15, que no es resolverlo:** el chequeo de silencio
vigila la TRM **por su propio vencimiento**. Cada registro trae
`vigenciahasta`, así que no hace falta inventar un umbral de frescura — la
misma propiedad que le permitió a T010 no llevar calendario de festivos.

- Un fetch fallido **no** es incidente: la tasa vigente sigue en vigor.
  Medido, **1 fallo en 83 corridas** — el único de cualquier fuente en la
  historia del proyecto.
- **No renovar antes de que venza la que tenemos** sí lo es.
- **No tener ninguna TRM** es un incidente distinto y peor, reportado aparte:
  no es una tasa vieja, es que no hay tasa.

El límite del día es **medianoche en Bogotá**, no en UTC. Leer `vigenciahasta`
como UTC daría la tasa por vencida cinco horas antes, todos los días.

**Lo que sigue sin resolverse:** si datos.gov.co queda caído más de un día, no
hay TRM que mostrar, y el Artículo III la necesita como referencia de
comparación. Las salidas posibles —ninguna elegida— son publicar la última
vigente marcándola como vencida, o retirar la columna de margen contra TRM
mientras dure. **Decidirlo con datos, no ahora:** con 1 fallo en 83 corridas
no hay evidencia de que el caso llegue a ocurrir.

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
- `[RESUELTO]` Constitution enmendado a v1.4.0. v1.1.0 tocó III.1 y III.5;
  v1.2.0, III.1, el corolario de I.2 y V.6; v1.3.0 acotó el alcance de "cruda"
  en I.2 tras verificar la persistencia contra la base real; v1.4.0 alineó
  III.2, que decía "rail", con las columnas `asset` + `channel` del esquema.
