# Tasks — Dolarito

**Ubicación esperada en el repo:** `specs/001-dolarito/tasks.md`
**Deriva de:** `plan.md` y `constitution.md` v1.3.0
**Fecha:** 2026-09-12

Convenciones:
- `[P]` = puede ejecutarse en paralelo con otras tareas marcadas igual.
- Cada tarea declara su criterio de terminado. Sin ese criterio cumplido, la
  tarea no está hecha.
- Las tareas se ejecutan en orden salvo que estén marcadas `[P]`.

---

## Fase 0 — Cimientos

**T001 — Inicializar monorepo**
Crear la estructura de `plan.md` §4. Workspaces de pnpm, TypeScript estricto,
Biome o ESLint, `.env.example` con las variables necesarias.
*Terminado cuando:* `pnpm install` corre limpio y el repo está en Git.

**T002 — Proyecto de Supabase**
Crear proyecto, guardar `SUPABASE_URL`, `SUPABASE_ANON_KEY` y
`SUPABASE_SERVICE_ROLE_KEY` en `.env` local y en los secretos del repo.
*Terminado cuando:* un script de prueba se conecta y lista tablas.

**T003 — Migración del esquema**
Implementar `providers`, `runs`, `quotes`, `market_history`, los CHECK, el índice
único, los índices de consulta y la vista `latest_quotes` exactamente como están
en `plan.md` §2. La vista incluye el corte de 24 horas y ambos márgenes.
*Terminado cuando:* la migración aplica en limpio; un insert duplicado en la
misma corrida es rechazado por el índice único; y un valor inválido de `status` o
`direction` es rechazado por el CHECK.

**T004 — Sembrar el catálogo de proveedores**
Insertar 8 filas: eldorado, dolarapp, binance_p2p, bitso, buda (modo local);
wise, instarem, western_union (modo remesa). Cada una con su `asset` y `channel`.
Las referencias **no** van acá: TRM y mid-market no son proveedores.
*Terminado cuando:* `select count(*) from providers` devuelve 8 y ninguna fila
tiene `asset` o `channel` nulos.

**T005 — Políticas RLS**
RLS activo **sin** política de lectura anónima (`plan.md` §2.3). Todo acceso de
lectura será desde servidor. Escritura solo con `service_role`.
*Terminado cuando:* un test con la `anon key` falla tanto al leer como al
escribir, y un test con clave de servidor lee correctamente.

## Fase 1 — Contrato y orquestación

**T006 — `contract.ts`**
Definir `Money`, `Quote`, `Reference`, `QuoteAdapter`, `ReferenceAdapter` y la
unión `Adapter` de `plan.md` §3, sin cambios. Los dos tipos de adapter existen
porque las referencias escriben en `runs`, no en `quotes`.
*Terminado cuando:* compila, está exportado, y un `Quote` con `status: 'ok'` pero
sin `in`/`out` no pasa el type check.

**T006b — `money.ts` con tests dorados** ⚠️
Implementar `computeAmounts()` como única fuente de verdad para derivar montos
(`plan.md` §3.1). Respetar el orden canónico: porcentual, luego fija, luego
conversión.
*Terminado cuando:* existen al menos cuatro casos dorados —dos por dirección—
verificados a mano por el humano, y pasan. **Ningún adapter puede escribirse
antes de que esta tarea esté cerrada** (Artículo VII.1).

**T006c — `http.ts`, cliente compartido**
Un solo punto de salida de red. Implementa: User-Agent identificable con forma de
contacto (Artículo V.4), timeout de 10s, backoff exponencial ante 429 y 5xx
(V.5), y registro del intervalo de refresco propio de cada fuente (V.3).
Documentar en el propio archivo qué cadencia declara cada fuente, para sustentar
que 15 minutos es conservador.
*Terminado cuando:* ningún adapter importa `fetch` directamente, y un test
verifica que un 429 dispara backoff en vez de reintento inmediato.

**T007 — Adapter falso**
Un adapter que devuelve filas fijas, para validar el flujo sin red. Incluir un
caso `out_of_range` y un caso que lanza, para cubrir ambos caminos.
*Terminado cuando:* devuelve `Quote[]` válidos para los cuatro brackets.

**T008 — Orquestador**
`Promise.allSettled` sobre el registro. Abre una fila en `runs`, resuelve primero
los `ReferenceAdapter` (pueblan `trm` y `mid_market` de esa misma fila), luego los
`QuoteAdapter`, y cierra con `sources_ok` y `sources_failed`.
Un adapter que lanza **no genera fila en `quotes`**: solo entra en
`sources_failed` (Artículo I.2).
**La unidad del conteo es el proveedor perdido, no el adapter caído.** Seis
adapters cubren ocho proveedores: `wise` es una llamada que devuelve tres. El
orquestador suma los `providerIds` de los adapters que fallaron; no cuenta
adapters. Contar adapters mediría nuestro código, no lo que el usuario deja de
ver.

Sale con código distinto de cero si ocurre **cualquiera** de las tres de
`plan.md` §5.1:
1. se perdieron **más de 4 de los 8 proveedores**;
2. **algún modo quedó sin ningún proveedor** — Wise sola vacía Remesa, y un modo
   vacío es indistinguible de que el sistema no exista para quien vino a eso;
3. falló cualquiera de las **2 referencias** (incidente, no degradación).

*Terminado cuando:* con un adapter sano y uno que lanza, las filas del sano se
guardan, `sources_failed` registra el otro, y `quotes` no tiene ninguna fila del
fallido. Además, dos tests fijan la unidad del conteo y la separación entre las
reglas 1 y 2:
- **un solo adapter caído que cubre 3 proveedores de un mismo modo dispara la
  salida**, por la regla 2 y no por la 1 — son 3 perdidos, que no superan 4;
- **cuatro adapters locales caídos, 4 proveedores perdidos, NO disparan**: no
  superan 4 y los dos modos siguen con proveedores vivos. Con el conteo por
  adapter esta corrida salía en rojo; con el conteo por proveedor no, y es
  correcto que no.

**T009 — Registro de adapters**
`registry.ts` exporta el array de adapters activos. Agregar una fuente debe ser
agregar una línea acá y nada más (Artículo II.4).
*Terminado cuando:* el orquestador no importa ningún adapter directamente.

## Fase 2 — Referencias

**T010 — Adapter de TRM** (`ReferenceAdapter`)
Endpoint: `https://www.datos.gov.co/resource/32sa-8pi3.json?$limit=1&$order=vigenciadesde DESC`.
Escribe `trm`, `trm_from` y `trm_to` en `runs`. **Usar `vigenciahasta`** del
propio dato para saber hasta cuándo rige: resuelve fines de semana y festivos sin
calcular calendario. Verificado: un viernes devuelve `vigenciahasta` del lunes.
*Terminado cuando:* una corrida guarda los tres campos y un test con fixture de
fin de semana confirma que `trm_to` cubre más de un día.

**T011 — Adapter de tasa media de mercado**
Primaria: Yahoo Finance `USDCOP=X`. Respaldo: `open.er-api.com`. Escribe
`mid_market`, `mid_market_src` y `mid_market_at` en `runs`. Debe consultarse en
el mismo ciclo que todo lo demás, nunca en uno aparte (Artículo III.5 y RF-04).
Cuando el mercado FX está cerrado el dato queda congelado: eso es correcto, no
se interpola. `mid_market_at` refleja el momento del dato, no el de la captura.
Verificado: Yahoo responde 200 con User-Agent identificable y honesto; solo
rechaza el User-Agent vacío. No hace falta suplantar un navegador (Artículo V.4).
*Terminado cuando:* `runs` tiene `trm` y `mid_market` poblados en la misma fila,
y un test verifica que al fallar Yahoo se usa el respaldo y `mid_market_src` lo
registra.

**T011b — Sembrar histórico de mid-market** `[P]` *(depende de T003)*
Carga única del histórico diario de `USDCOP=X` en la tabla `market_history`
definida en `plan.md` §2. Nunca se mezcla con `runs` ni con `quotes`.
*Terminado cuando:* hay al menos 6 meses de serie diaria en `market_history` y
`select count(*) from runs` no cambió.

> Estas dos tareas habilitan HU-08. Sin ellas corriendo desde el día uno, esa
> función no podrá construirse nunca sobre el histórico.

## Fase 3 — Adapters, de simple a complejo

> **Regla de fase, T012 a T017.** Cada tarea de adapter anota en la tabla de
> cadencias de `packages/ingest/src/http.ts` el **límite de tasa real** que
> publica esa fuente, con el enlace a dónde lo dice. Si la fuente **no publica
> ninguno**, se anota eso mismo, con la fecha en que se buscó y dónde.
>
> Lo que no se puede es dejar el hueco sin marcar. Esa tabla es lo que sostiene
> que nuestros 15 minutos son conservadores (Art. V.3), y una fila en blanco se
> lee como "verificado" al mes siguiente. Inventar la cifra es peor todavía:
> sería un dato fabricado usado para justificar nuestra propia cadencia.
>
> Ninguna tarea de esta fase está terminada con la tabla sin tocar.

**T012 — `bitso`** `[P]`
`ask`/`bid` del ticker `usdt_cop`. `asset: 'usdt'`, `channel: 'exchange'`. Dos
direcciones × cuatro brackets. La tasa no varía por monto; lo que varía es el
lado variable, vía `computeAmounts()`. `amounts_source: 'computed'`.
*Terminado cuando:* 8 filas por corrida, todas con `fixed_side` correcto según
dirección, y test con fixture. Además, la tabla de cadencias de `http.ts` queda
anotada para esta fuente.

**T013 — `dolarapp`** `[P]`
`ask`/`bid` de `v1/tickers?currencies=COP`. `asset: 'usdc'`, `channel: 'fintech'`.
Sin comisión explícita: `fee_*` queda `undefined`, nunca cero (Artículo I.1).
*Terminado cuando:* 8 filas y test con fixture. Además, la tabla de cadencias de
`http.ts` queda anotada para esta fuente.

**T014 — `buda`** `[P]`
`min_ask`/`max_bid` de `USDT-COP`. `asset: 'usdt'`, `channel: 'exchange'`. Marcar
en `notes` del proveedor que el libro es delgado y el spread ancho.
*Terminado cuando:* 8 filas y test con fixture. Además, la tabla de cadencias de
`http.ts` queda anotada para esta fuente.

**T015 — `eldorado`**
Un POST por bracket **y por método de pago**. Primero consultar `methods` para los
IDs de COP. `asset: 'usdt'`, `channel: 'p2p'`.
**Atención al mapeo de comisiones:** `fees.total[].rate` es la fracción
(→ `fee_pct`); `fees.total[].value` es el monto absoluto (→ `fee_amount_usd`).
Confundirlos corrompe los montos en silencio. Verificar contra una respuesta real
antes de implementar.
Su API ya usa `fixedSide`, `amountIn` y `amountOut`: mapean directo al contrato y
por eso `amounts_source: 'provider'` — no recalcular.
Mínimo de 5 USD: el bracket de 1 genera fila con `status: 'out_of_range'` y
`limit_reason: 'below_minimum'`.
*Terminado cuando:* genera filas por método; el bracket de 1 USD queda
`out_of_range`; y un test confirma que `fee_pct` recibió `rate` y no `value`.
Además, la tabla de cadencias de `http.ts` queda anotada para esta fuente.

**T016 — `binance_p2p`**
No hay precio único. Recorrer los anuncios acumulando `dynamicMaxSingleTrans*`
hasta cubrir el bracket, y calcular el **precio ponderado por volumen**. Guardar
el top 10 crudo en `raw`. Dos llamadas: `BUY` y `SELL`. `asset: 'usdt'`,
`channel: 'p2p'`. Si la liquidez no alcanza el bracket, `status: 'out_of_range'`
con `limit_reason: 'insufficient_liquidity'`.
*Terminado cuando:* un test con fixture verifica el cálculo ponderado contra un
resultado calculado a mano. Además, la tabla de cadencias de `http.ts` queda
anotada para esta fuente.

**T017 — `wise`**
Una llamada por bracket devuelve Wise, Instarem y Western Union. Produce 3 filas
por bracket, todas con `mode: 'remesa'`. Mapear `fee` a `fee_fixed_usd` y
`deliveryEstimation` a `eta_minutes`.
*Terminado cuando:* 12 filas por corrida (3 proveedores × 4 brackets) y test con
fixture. Además, la tabla de cadencias de `http.ts` queda anotada para esta
fuente.

**T017 — `wise`**, continuación: `amounts_source: 'provider'` — `receivedAmount`
es el monto final de la fuente y no se recalcula. `fee` es absoluto en USD
(→ `fee_fixed_usd`). `asset: 'usd'`, `channel: 'bank_transfer'`.

## Fase 4 — Operación

**T018 — Workflow de ingesta**
`.github/workflows/ingest.yml`, cron `*/15 * * * *`, con `workflow_dispatch`
para disparo manual. Secretos desde el repo.
*Terminado cuando:* corre solo y deja filas en `runs` y `quotes`.

**T019 — Alerta de silencio**
Job diario que consulta si alguna fuente lleva más de 6 horas sin filas. Falla
ruidosamente si la hay. Sirve además como actividad que evita que Actions
deshabilite los cron por inactividad.
*Terminado cuando:* falla a propósito al simular una fuente muda.

**T020 — Ventana de acumulación (7 días)** ⛔
**No iniciar ninguna tarea de frontend hasta completar esta.** Dejar la ingesta
corriendo una semana. Al final, revisar: qué adapters se rompieron, qué tan
ruidoso es cada dato, si algún bracket nunca tiene datos.
*Terminado cuando:* hay 7 días de datos y un resumen escrito de los hallazgos.

> Artículo VI.3. Esta tarea existe para que no se diseñe interfaz sobre datos
> hipotéticos. Es trabajo, no espera.

## Fase 5 — Frontend

**T021 — Proyecto Astro + adapter de Vercel**
Estructura base, tipografía, tokens. Móvil primero (RF-12).
*Terminado cuando:* despliega en Vercel.

**T022 — Middleware de contraseña**
Contraseña compartida desde variable de entorno. Quitarla debe ser cambiar la
env var, no el código (HU-07).
*Terminado cuando:* sin cookie válida todo redirige al formulario.

**T023 — Cliente de datos (servidor)**
Leer `latest_quotes` **desde el servidor** con clave de servidor. Ninguna clave
llega al navegador (`plan.md` §2.3). El servidor entrega en la carga inicial las
cotizaciones de los cuatro brackets —unas 64 filas— para que el selector filtre
en cliente sin consultar la base.
*Terminado cuando:* una página imprime las cotizaciones actuales y el bundle del
navegador no contiene ninguna credencial de Supabase.

**T024 — Bloque de TRM**
Valor, fecha a la que corresponde, explicación breve. Indicador explícito de
congelada en fines de semana y festivos (HU-05).
*Terminado cuando:* el estado de fin de semana se ve distinto del de día hábil.

**T025 — Rankings**
Selector de modo (Local / Remesa), dirección y bracket. Orden según Artículo
III.1: `amount_out` DESC cuando `fixed_side='in'`, `amount_in` ASC cuando
`fixed_side='out'`. Nunca por tasa. Diferencia contra el primero expresada en
dinero. Filas `out_of_range` visibles con su `limit_reason` (HU-04). Cada fila
declara su `asset`: el usuario debe ver que el modo Local es stablecoin.
*Terminado cuando:* cambiar de bracket reordena, y el bracket de 1 USD muestra
los no disponibles con explicación.

**T026 — Frescura del dato**
Momento de captura visible en cada fila. Marca de desactualizado sobre 60
minutos. Aviso si una fuente lleva tiempo muda (HU-06, RF-11).
*Terminado cuando:* forzando un dato viejo, la marca aparece.

**T027 — Fichas de proveedor** `[P]`
Una página por proveedor: qué es, rail, modo, métodos de pago (RF-15).
*Terminado cuando:* los 8 tienen página.

**T028 — Contenido explicativo** `[P]`
Página sobre qué es la TRM y por qué ninguna app la ofrece (RF-14). En Markdown.
*Terminado cuando:* publicada y enlazada desde el bloque de TRM.

## Fase 6 — Cierre

**T029 — Revisión contra el constitution**
Recorrer los siete artículos y verificar cumplimiento uno por uno.
*Terminado cuando:* existe un checklist firmado, con las desviaciones
justificadas por escrito.

**T030 — Dominio y decisión de apertura**
Apuntar dominio. Decidir si se quita la contraseña.
*Terminado cuando:* el sitio responde en su dominio.

---

## Dependencias

```
T001 → T002 → T003 → T004 → T005
                       ↓
       T006 → [T006b ⚠️ T006c] → T007 → T008 → T009
                                     ↓
                          T010 → T011 → T011b
                                     ↓
              [T012 T013 T014] → T015 → T016 → T017
                                                 ↓
                                       T018 → T019 → T020 ⛔
                                                       ↓
                          T021 → T022 → T023 → [T024 T025 T026]
                                                       ↓
                                              [T027 T028] → T029 → T030
```

## Bloqueos conocidos

- **T030** requiere el dominio, aún sin decidir. Único pendiente abierto.
- **T020** es una barrera dura: ninguna tarea de la Fase 5 empieza antes.
- **T006b** es barrera dura hacia la Fase 3: sin la función de montos probada, no
  se escribe ningún adapter.
- **T011b** depende de T003 (necesita `market_history`).
