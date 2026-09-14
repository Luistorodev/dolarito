# Tasks — Dolarito

**Ubicación esperada en el repo:** `specs/001-dolarito/tasks.md`
**Deriva de:** `plan.md` y `constitution.md` v1.4.0
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
Endpoint: `https://www.datos.gov.co/resource/32sa-8pi3.json?$limit=1&$order=vigenciadesde%20DESC`.
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
>
> **Segunda regla de fase: la aserción del spread** (`plan.md` §3). Todo adapter
> de **libro único** que cotice las dos direcciones lleva en su test una
> comprobación **por valor**
> de que, para un mismo bracket, los pesos que se pagan por N dólares superan a
> los pesos que se reciben por N dólares. Un libro invertido produce filas
> impecables —tipos, `fixed_side`, monedas, escalado— y solo cambia que el
> proveedor aparece mejor de lo que es. Ningún test de estructura lo ve.
>
> **`binance_p2p` queda fuera de esa regla y lleva las suyas**, porque en P2P los
> dos lados son mercados separados y el cruce es un estado real (`plan.md` §3).
> En su lugar: filtro de mínimos aplicado, y el mapeo invertido de `tradeType`
> anclado por valor.

**T012 — `bitso`** `[P]`
`ask`/`bid` del ticker `usdt_cop`. `asset: 'usdt'`, `channel: 'exchange'`. Dos
direcciones × cuatro brackets. La tasa no varía por monto; lo que varía es el
lado variable, vía `computeAmounts()`. `amounts_source: 'computed'`.
*Terminado cuando:* 8 filas por corrida, todas con `fixed_side` correcto según
dirección, y test con fixture. Además, la tabla de cadencias de `http.ts` queda
anotada para esta fuente. Y el test incluye la aserción del spread por valor
(`plan.md` §3).

**T013 — `dolarapp`** `[P]`
`ask`/`bid` de `v1/tickers?currencies=COP`. `asset: 'usdc'`, `channel: 'fintech'`.
Sin comisión explícita: `fee_*` queda `undefined`, nunca cero (Artículo I.1).
*Terminado cuando:* 8 filas y test con fixture. Además, la tabla de cadencias de
`http.ts` queda anotada para esta fuente. Y el test incluye la aserción del
spread por valor (`plan.md` §3).

**T014 — `buda`** `[P]`
`min_ask`/`max_bid` de `USDT-COP`. `asset: 'usdt'`, `channel: 'exchange'`. Marcar
en `notes` del proveedor que el libro es delgado y el spread ancho.
*Terminado cuando:* 8 filas y test con fixture. Además, la tabla de cadencias de
`http.ts` queda anotada para esta fuente. Y el test incluye la aserción del
spread por valor (`plan.md` §3).

**T015 — `eldorado`**
Un POST por bracket **y por método de pago**. Primero consultar `methods` para los
IDs de COP. `asset: 'usdt'`, `channel: 'p2p'`.
**Atención al mapeo de comisiones:** `fees.total[].rate` es la fracción
(→ `fee_pct`); `fees.total[].value` es el monto absoluto (→ `fee_amount_usd`).
Confundirlos corrompe los montos en silencio. Verificar contra una respuesta real
antes de implementar.
Su API ya usa `fixedSide`, `amountIn` y `amountOut`: mapean directo al contrato y
por eso `amounts_source: 'provider'` — no recalcular.
**Corregido contra respuesta verificada el 2026-09-13: no hay mínimo de 5 USD.**
Era un dato afirmado sin fuente. La API cotiza 0,5, 1 y 5 USD con `200`; lo que
existe es un piso de comisión de 0,49 USDT que en montos chicos domina el precio
(1 USD sale a 5.215 COP/USDT contra 3.129 a bracket 100). El bracket de 1
**genera fila `ok` con su precio real**: no está fuera de rango, está caro, y
esconderlo tapa justo lo que HU-04 quiere mostrar. Ver `plan.md` §3.2.

Solo se cotizan **4 de los 11 métodos** COP — `bank_bancolombia`, `app_nequi_co`,
`app_daviplata_co`, `app_llave_co` — por costo propio, no por límite de la
fuente. 4 × 4 brackets × 2 direcciones = **32 filas por corrida**, no 8.
*Terminado cuando:* genera 32 filas, una por método × bracket × dirección; el
bracket de 1 USD sale `ok` con su precio real y su `fee_pct` alto; y un test
confirma que `fee_pct` recibió `rate` y no `value`.
Además, la tabla de cadencias de `http.ts` queda anotada para esta fuente. Y el
test incluye la aserción del spread por valor (`plan.md` §3).

**T016 — `binance_p2p`**
No hay precio único. Recorrer los anuncios acumulando `dynamicMaxSingleTrans*`
hasta cubrir el bracket, y calcular el **precio ponderado por volumen**. Guardar
el top 10 crudo en `raw`. Dos llamadas: `BUY` y `SELL`. `asset: 'usdt'`,
`channel: 'p2p'`. Si la liquidez no alcanza el bracket, `status: 'out_of_range'`
con `limit_reason: 'insufficient_liquidity'`.

**Atención al `tradeType`: el que se pide y el que trae el anuncio están
invertidos por diseño.** Se pide `BUY` y los anuncios responden `SELL`, porque
describen la operación desde el lado del anunciante, no del usuario. Leer el
nombre del campo y confiar en él es exactamente cómo se introduce el error.
Acá la aserción del spread por valor no es una comprobación más: **es la única
defensa real**, porque el mapeo invertido produce filas perfectamente bien
formadas.

**Revisado el supuesto de `insufficient_liquidity` (2026-09-13), y sobra a medias
mientras falta el otro.** Medido: hay 260 anuncios del lado BUY y 347 del SELL, y
1000 USDT se cubren con 1 a 3 anuncios. La liquidez **prácticamente nunca** va a
quedar corta a nuestros brackets. No es un supuesto falso como el mínimo de
Eldorado —puede pasar en una madrugada mala— pero es una rama que no se va a
ejercer sola, así que **hay que probarla con un fixture recortado a propósito**;
si no, nunca se sabrá si funciona.

**Lo que sí falta es `below_minimum`, que este documento no menciona y va a
dispararse en todas las corridas.** Cada anuncio trae `minSingleTransAmount`, y
medido sobre 20 anuncios el mínimo más bajo equivale a 10,9 USDT:

| Bracket | Anuncios que lo aceptan |
|---|---|
| 1 | **0 de 20** → `out_of_range` / `below_minimum` |
| 100 | 8 de 20 |
| 500 | 19 de 20 |
| 1000 | 20 de 20 |

Vale notar la simetría: el plan puso `below_minimum` en Eldorado, donde es falso,
y lo omitió en Binance, donde es cierto en cada ciclo. Acá el bracket de 1 **sí**
genera fila `out_of_range`, y por la razón correcta: ningún anuncio opera a ese
monto.
*Terminado cuando:* un test con fixture verifica el cálculo ponderado contra un
resultado calculado a mano. Además, la tabla de cadencias de `http.ts` queda
anotada para esta fuente. Y el test incluye la aserción del spread por valor
(`plan.md` §3).

**T017 — `wise`**
Una llamada por bracket devuelve **hasta** Wise, Instarem y Western Union: hasta
3 filas por bracket, todas con `mode: 'remesa'`, `asset: 'usd'`,
`channel: 'bank_transfer'`. Mapear `fee` —absoluto en USD— a `fee_fixed_usd`, y
`deliveryEstimation` a `eta_minutes`. `amounts_source: 'provider'`:
`receivedAmount` es el monto final de la fuente y **no se recalcula**.
*Terminado cuando:* **hasta** 12 filas por corrida (3 proveedores × 4 brackets,
según cuáles devuelva la API) y test con fixture. Verificado el 2026-09-13: en el
bracket de 1 USD solo responde `instarem`, así que son 10. Un proveedor ausente
**no genera fila** — la API no dice por qué falta y `below_minimum` sería
inferirlo (`plan.md` §3.3). Además, la tabla de cadencias de `http.ts` queda anotada para esta
fuente. Y el test incluye la aserción del spread por valor (`plan.md` §3).

## Fase 4 — Operación

**T018 — Workflow de ingesta**
`.github/workflows/ingest.yml`, cron `*/15 * * * *`, con `workflow_dispatch`
para disparo manual. Secretos desde el repo.
*Terminado cuando:* corre solo y deja filas en `runs` y `quotes`.

**T019 — Alerta de silencio**
Job diario que consulta si alguna fuente lleva más de 6 horas sin filas. Falla
ruidosamente si la hay. Sirve además como actividad que evita que Actions
deshabilite los cron por inactividad.

**Para las referencias, el criterio NO puede ser `mid_market_at` contra
`captured_at` en una sola corrida.** Medido en T011, el 2026-09-13, con el
mercado FX cerrado: Yahoo devolvió un dato marcado ese mismo domingo a las
20:00Z —minutos antes de la captura— aunque la última sesión había cerrado el
viernes a las 22:59Z. El desfase de fin de semana es de **minutos, no de días**.

Por qué importa: la intuición natural es "si el dato es viejo, algo se rompió", y
con esa regla un mercado cerrado **nunca** dispararía la alarma, mientras una
ingesta colgada tampoco lo haría — porque una ingesta colgada devuelve un
`mid_market_at` que, visto en una sola fila, se ve igual de reciente que uno
sano. Una corrida aislada no contiene la información necesaria. No es que el
umbral esté mal calibrado: es que la señal no está ahí.

Lo que sí distingue los dos casos es la **repetición a lo largo de varias
corridas**, y hay que mirar la marca y el valor juntos:

| A lo largo de N corridas | `mid_market_at` | `mid_market` | Qué es |
|---|---|---|---|
| Ingesta colgada | idéntico | idéntico | **incidente** |
| Mercado cerrado | puede avanzar | quieto | normal, no se toca |
| Mercado abierto | avanza | se mueve | sano |

El caso que hay que atrapar es el primero: **la misma marca de tiempo repetida
corrida tras corrida**. Un valor quieto por sí solo no es señal de nada — un fin
de semana entero lo produce legítimamente, y el Artículo I.4 exige dejarlo
quieto, no interpolarlo.

*Terminado cuando:* falla a propósito al simular una fuente muda, y un test
distingue una ingesta colgada —marca y valor repetidos en corridas sucesivas— de
un fin de semana con el mercado cerrado, **sin marcar el segundo**.

**T020 — Ventana de acumulación (7 días)** ⛔ *barrera acotada — ver abajo*
Dejar la ingesta corriendo una semana. Al final, revisar: qué adapters se rompieron, qué tan
ruidoso es cada dato, si algún bracket nunca tiene datos.
*Terminado cuando:* hay 7 días de datos y un resumen escrito de los hallazgos.

> Artículo VI.3. Esta tarea existe para que no se diseñe interfaz sobre datos
> hipotéticos. Es trabajo, no espera.

### Qué bloquea T020, y qué no — acotado el 2026-09-14

La barrera decía "ninguna tarea de la Fase 5 empieza antes". **Era más ancha que
su propio motivo.** El Artículo VI.3 prohíbe diseñar interfaz sobre datos
**hipotéticos**; no prohíbe construirla sobre datos que ya existen. Con 3
corridas reales y 222 filas, los rankings ya ordenan de verdad. Lo que falta no
es *dato*: es *estabilidad del dato*, y eso solo condiciona las decisiones de
**presentación** que dependen de cómo se comporta la serie a lo largo de una
semana.

**No bloqueadas** — se pueden hacer ya:

| Tarea | Por qué no depende de la ventana |
|---|---|
| T021 | Estructura, tipografía, despliegue. Cero dato. |
| T022 | Autenticación. Cero dato. |
| T023 | Lee lo que ya hay. Ver la advertencia dentro de la tarea. |
| T024 | La vigencia de la TRM sale del propio dato, no de la serie (T010). |
| T025 **parcial** | El ranking y su orden (Art. III.1). **No** la representación de Eldorado. |
| T026 | La marca se prueba forzando un dato viejo, no esperando. |

**Siguen bloqueadas** — son exactamente las preguntas que la semana existe para
responder, y las tres tienen ya una primera lectura que apunta en una dirección:

1. **Cuántos métodos de Eldorado se muestran y cómo** — el `[NECESITA DECISIÓN]`
   de T025. Depende del punto 3 de la revisión de cierre: al 2026-09-14 los 4
   métodos **no** colapsan (14 de 24 celdas difieren, hasta 10,5 % comprando en
   el bracket de 1), así que recortar la lista borraría diferencias reales.
2. **Si el selector de bracket se destaca o se esconde** — punto 5: vendiendo el
   líder cambia con el bracket, comprando no cambia nunca. La asimetría **entre
   direcciones** no estaba prevista y cambia cómo HU-04 se presenta.
3. **Si el cruce de `binance_p2p` se explica en la interfaz** (RF-11c) — punto 4:
   3 de 9 celdas, concentrado en los brackets grandes.

**Regla para lo que se construya mientras tanto:** todo lo que dependa de esos
tres puntos se marca en el código como **pendiente de datos** —parámetro
explícito y sin valor por defecto, que obligue a elegir— y **nunca** con un
default provisional, que es la forma en que una decisión no tomada se vuelve
permanente por inercia.

> ⚠️ **El cron sigue sin disparar, y eso sí bloquea todo.** El Artículo VI.3
> exige que la ingesta se **opere**, no solo que exista; las 3 corridas son
> disparos manuales. Eso no es T020 incompleta: es **T018 incompleta**, y acotar
> esta barrera no lo toca ni lo disimula.

## Fase 5 — Frontend

> **Prerrequisito de DDL, descubierto al acotar la barrera (2026-09-14).**
> `latest_quotes` no expone tres columnas de `runs` que la Fase 5 necesita:
> **`trm_from` y `trm_to`** —sin ellas T024 no puede marcar la TRM congelada, y
> las columnas ya existen en la tabla, solo faltan en el `select`— y
> **`mid_market_src`**, sin la cual mostrar un margen contra mid-market mezcla
> en silencio dos mediciones distintas (Yahoo intradía y er-api diaria, T011).
> Van en la **misma migración** que la corrección de márgenes de `plan.md` §2.2,
> que reescribe esa vista de todos modos: junto cuesta una aplicación a mano en
> el SQL Editor, separado cuesta dos.

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
cotizaciones de los cuatro brackets —**74 filas medidas** en la primera corrida
real, no las 64 estimadas— para que el selector filtre en cliente sin consultar
la base.

**Advertencia:** cuántas filas son depende de la decisión pendiente de T025, que
dice de sí misma que "afecta qué consulta el servidor". Mientras siga abierta,
T023 trae **todas** las filas y el recorte ocurre más arriba — decisión
deliberada, no un descuido, para que elegir la política no obligue a reescribir
el cliente de datos.
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
**[NECESITA DECISIÓN] — Eldorado produce 4 filas por bracket y dirección; los
demás, 1.** Es el único con dimensión de método de pago (`payment_method`), y eso
rompe la simetría del ranking de una forma que favorece sistemáticamente a
Eldorado: tomar su mejor método lo compara contra el **único** método de
proveedores que no tienen alternativa. No es lo mismo "el mejor de cuatro" que
"el único", y el Artículo III.3 exige que toda comparación sea a monto fijo entre
cosas comparables.

Las tres salidas, ninguna obviamente correcta:

| Opción | A favor | En contra |
|---|---|---|
| **Mejor método, declarando cuál** | Una fila por proveedor, ranking legible | Sigue siendo el mejor de cuatro contra el único de otros; la ventaja queda pero al menos visible |
| **Todas las filas** | Honesto y completo | Eldorado ocupa 4 de cada 11 posiciones del ranking, y lo domina visualmente sin ser mejor |
| **Un método por defecto** | Comparación pareja de verdad | Elegirlo es una decisión nuestra sobre qué método "cuenta", y castiga a Eldorado si el elegido es el peor |

**No puede resolverse al implementar la UI.** Afecta qué consulta el servidor, qué
significa una posición del ranking y si HU-01 sigue respondiendo la pregunta que
promete. Decidir antes de escribir T025.

**Además, en modo Remesa un proveedor puede faltar sin motivo conocido.** La API
de Wise no reporta la ausencia ni su causa (`plan.md` §3.3), así que la interfaz
**no debe inventar uno**. Si hay que mostrar algo, es **que no hay dato** — no que
esté fuera de rango, ni que el proveedor no opere a ese monto. Verificado: en el
bracket de 1 USD faltan Wise y Western Union en cada corrida.

**Corte parcial (2026-09-14):** el ranking, su orden y el bracket de 1 USD se
construyen ya; la **representación de Eldorado** espera a la ventana. Las dos
mitades no son capas separadas —la política decide qué *es* una fila— así que la
forma de dejarla pendiente sin decidirla es implementar **las tres opciones**
detrás de un parámetro obligatorio **sin default**: el código no compila ni corre
sin que alguien elija. Medido al 2026-09-14, las tres coinciden en el líder
porque Eldorado no lidera ninguna celda; eso lo hace seguro de construir y es
justamente por qué no debe colarse como default.

*Terminado cuando:* cambiar de bracket reordena, el bracket de 1 USD muestra
los no disponibles con explicación, y la decisión de arriba está tomada y
aplicada. **Parcialmente terminable antes de T020**, salvo esa decisión.

**T026 — Frescura del dato**
Momento de captura visible en cada fila. Marca de desactualizado sobre 60
minutos. Aviso si una fuente lleva tiempo muda (HU-06, RF-11).
*Terminado cuando:* forzando un dato viejo, la marca aparece.

**Construible ya, pero el umbral no es calibrable todavía.** Los 60 minutos solo
se pueden juzgar contra una cadencia real, y hoy los huecos entre corridas son de
31 y 81 minutos **por el cron ausente**, no por las fuentes. Implementar el
mecanismo y dejar el umbral como constante nombrada; revisarlo cuando el cron
corra.

**T027 — Fichas de proveedor** `[P]`
Una página por proveedor: qué es, `asset` y `channel`, modo, métodos de pago (RF-15).
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
                                       T018 → T019 → T020 ⛔ acotada
                                         │                     │
            ┌────────────────────────────┘                     ↓
            ↓                                        3 decisiones de
   T021 → T022 → T023 → [T024 T025 ◐ T026]            presentación
                                ↓                             │
                        [T027 T028] → T029 → T030 ←───────────┘

   ◐ T025 va parcial: el ranking y su orden se construyen ya; la
     representación de Eldorado espera a que cierre la ventana.
```

## Bloqueos conocidos

- **T030** requiere el dominio, aún sin decidir. Único pendiente abierto.
- **T020** es una barrera **acotada** desde el 2026-09-14: bloquea las tres
  decisiones de presentación listadas bajo la tarea, no la Fase 5 entera.
  T021–T024 y T026 quedan libres; T025 va parcial.
- **T018 sigue incompleta.** El cron disparó por primera vez el 2026-09-14 y
  **falló en 8 s** en `setup-node@v5`, sin consultar ninguna fuente. La causa
  fue el bump de actions a v5 (`460db1a`), no el `cron:`; el arreglo
  —`pnpm/action-setup` antes de `setup-node`, en los dos workflows— está
  aplicado. **Cierra cuando se hayan visto en verde las dos rutas sobre el YAML
  corregido: un disparo manual y un ciclo programado.** Un verde manual no es
  evidencia sobre la ruta programada, y fue justamente esa suposición la que
  dejó pasar el bump. El Artículo VI.3 pide que la ingesta se *opere*.
- **T006b** es barrera dura hacia la Fase 3: sin la función de montos probada, no
  se escribe ningún adapter.
- **T011b** depende de T003 (necesita `market_history`).
