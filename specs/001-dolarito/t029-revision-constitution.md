# T029 — Revisión contra el constitution

**Fecha:** 2026-09-15 · **Constitution:** v1.4.0 · **Revisado contra:** el código,
no la memoria.

Cada punto cita **dónde** se cumple. Donde no se cumple, la razón queda escrita;
donde no hay razón, queda como deuda.

Una aclaración de método, que es la regla que este proyecto acaba de adoptar:
**una cita no es una verificación.** Todo lo que sigue se comprobó abriendo el
archivo. Cuando algo no se pudo comprobar, lo dice.

---

## Artículo I — Integridad del dato

| # | Estado | Dónde |
|---|---|---|
| I.1 Nunca se infiere un valor faltante | ✅ | `db.ts:22` `orNull()` traduce `undefined → null` una sola vez. Mutación en T012 (`fee_pct: 0` en vez de `undefined`) atrapada. |
| I.2 Se persiste la respuesta cruda | ✅ | `quotes.raw jsonb not null`, esquema línea 72. |
| I.2 Corolario: un fallo no genera fila | ✅ | `orchestrator.ts:173` — comentario *"Deliberately no row of any kind"*, y el encabezado del archivo lo enuncia como regla 1. |
| I.2 Alcance de "cruda" | ✅ | Acotado en v1.3.0 tras verificar contra la base: `jsonb` reordena claves. |
| I.3 Ninguna fila sin `captured_at` | ✅ | `captured_at timestamptz not null`, esquema línea 70. |
| I.4 No se rellenan huecos | ✅ | `market-history.ts:99-101` — festivo con `close: null` se salta, *"never interpolated"*. |

### ⚠️ Una aparente violación de I.1 que no lo es, y conviene dejar dicha

`money.ts:67-68` hace `input.fee_pct ?? 0` y `input.fee_fixed_usd ?? 0`. Leído
suelto parece exactamente lo que I.1 prohíbe.

No lo es, y la distinción importa: **eso es aritmética, no persistencia.** La
columna sigue guardando `null` —lo hace `orNull()`, y hay mutación que lo
prueba—. Lo que el `?? 0` dice es "no hay ajuste que aplicar", no "la comisión
es cero". Un proveedor que no declara comisión la tiene dentro del precio, que
es justo lo que la ficha de T027 le dice al lector.

**Queda anotado porque es el tipo de línea que alguien va a marcar como
violación en seis meses**, y la respuesta debe estar escrita antes de esa
discusión.

---

## Artículo II — Aislamiento de fallos

| # | Estado | Dónde |
|---|---|---|
| II.1 Un adapter caído no tumba la corrida | ✅ | `orchestrator.ts:126,152` — `Promise.allSettled` para referencias y cotizaciones. |
| II.2 Cada adapter en su archivo, sin conocer a los demás | ✅ | 6 archivos en `adapters/`. **Test estructural** en T009 que *lee el fuente* de `orchestrator.ts` y falla si importa un adapter concreto. |
| II.3 Timeout obligatorio | ✅ | `http.ts:178` `AbortSignal.timeout(timeoutMs)`, 10 s por intento. Ningún adapter importa `fetch`. |
| II.4 Fuente nueva = archivo + línea en el registro | ✅ | `registry.ts`, 16 referencias a factories. `inspectRegistry()` detecta id duplicado, proveedor reclamado dos veces y proveedor fuera del catálogo. |

---

## Artículo III — Comparabilidad honesta

| # | Estado | Dónde |
|---|---|---|
| III.1 Orden por el lado variable, nunca por la tasa | ✅ | `ranking.ts` `comparableAmount()` + `betterIsHigher()`. Test con el caso real: Wise anuncia mejor tasa que Binance y **pierde**. Verificado sobre HTML renderizado, descendente vendiendo y ascendente comprando. |
| III.2 Cada fila declara `asset` y `channel` | ✅ | `Ranking.astro` — `assetLabel()` y `channelLabel()` en cada fila. Renderizado: *"USDT · exchange"*, *"dólares · transferencia bancaria"*. |
| III.3 Toda comparación a monto fijo | ✅ | `bracket_usd` es `not null` con CHECK de cuatro valores; el selector no permite comparar sin bracket. |
| III.4 Las referencias nunca entran al ranking | ✅ | `grep trm\|mid_market ranking.ts` → **cero coincidencias**. Las referencias viven en `BloqueTrm.astro`, en otra jerarquía. |
| III.5 Roles separados de las dos referencias | ⚠️ | Ver abajo. |

### ⚠️ III.5 — DEUDA: el margen está calculado y no se muestra

El artículo dice que la tasa media en vivo es *"la base de todo cálculo de
margen"*. En la base lo es: `latest_quotes` expone `markup_vs_mid` y
`markup_vs_trm`, los dos corregidos en la migración del 14 —desde el monto
efectivo, con el signo unificado— y verificados con su script.

**Pero `grep markup_vs` sobre `apps/web/src` no devuelve nada.** La reescritura
de T025 sacó la columna de margen de las filas y nadie lo notó.

Consecuencias:

- **No viola ningún artículo**, porque ninguno obliga a mostrar el margen. III.5
  queda satisfecho de forma vacía.
- **Pero `trm.md` dice** *"Eso es exactamente lo que mide la columna de margen en
  la comparación"* — señalando algo que no existe. Es una página publicada que
  describe una función ausente.
- Y el trabajo de corregir los dos defectos del margen, que costó una migración
  a mano, **no llega al usuario**.

**Deuda, no desviación justificada.** Hay que decidir si el margen vuelve a la
fila —y contra cuál referencia— o si `trm.md` deja de prometerlo.

---

## Artículo IV — Honestidad con quien lo usa

| # | Estado | Dónde |
|---|---|---|
| IV.1 Momento de captura visible, no en tooltip | ✅ | `Ranking.astro` — `ageLabel()` en cada fila, texto plano. |
| IV.2 Más de 60 minutos se marca | ✅ | `STALE_MINUTES = 60`, estricto. `check:freshness` lo verifica sobre HTML renderizado en tres escenarios. |
| IV.3 La TRM siempre con su explicación | ⚠️ | Ver abajo. |
| IV.4 No se recomienda, se informa | ✅ | Ninguna página emite consejo. El ranking ordena por monto y nombra el criterio; `trm.md` explica y no sugiere operar. |

### ⚠️ IV.3 — El constitution afirma una metodología que nadie verificó

El artículo dice que la TRM es *"una tasa de referencia **calculada sobre
operaciones interbancarias del día hábil anterior**"* (línea 89).

La interfaz **no dice eso**. `BloqueTrm.astro:67` dice *"quién la calcula y cómo,
no lo afirmamos de memoria"*, y `trm.md` tiene una sección entera declinando
parafrasear la metodología.

Los dos no pueden tener razón. Y la pregunta que lo resuelve es la regla nueva:
**¿alguien verificó esa frase contra la fuente?** El constitution se ratificó el
2026-09-12, antes de que existiera un solo adapter. La frase es anterior a
cualquier medición.

Así que hay **una afirmación sin fuente en el documento que gobierna el
proyecto**, y la implementación se apartó de ella en silencio en vez de
señalarla. Eso es exactamente el patrón que el proyecto acaba de decidir que no
tolera, una capa más arriba.

**No lo resuelvo yo: enmendar el constitution es decisión del humano.** Las
salidas son verificar la metodología contra la Superintendencia Financiera y
dejar la frase, o acotarla como se acotó I.2 en la v1.3.0.

Mientras tanto la interfaz **sí cumple la intención de IV.3** —la TRM nunca
aparece sin explicación de por qué nadie la ofrece— y eso es lo que el artículo
protege.

---

## Artículo V — Respeto a las fuentes

| # | Estado | Dónde |
|---|---|---|
| V.1 Solo endpoints JSON | ✅ | Los ocho adapters usan `httpJson()`. Cero scraping. |
| V.2 Nada de tráfico móvil ni endpoints autenticados | ✅ | Documentado en T015: `api.eldorado.io` se descartó por exigir client credentials y KYC; se usa el endpoint público. |
| V.3 Cadencia conservadora | ✅ | Ver abajo — **mejor de lo que CLAUDE.md afirma**. |
| V.4 User-Agent identificable | ✅ | `http.ts` valida y **falla duro**: ausente, sin URL ni correo, o con el marcador `.invalid` ⇒ error, no advertencia. Mutación que lo quita, atrapada. |
| V.5 Backoff exponencial | ✅ | 429, 5xx y 504; 1000→2000→4000 ms con jitter ±20 %. `Retry-After` manda sobre nuestro horario. Siete mutaciones, ninguna sobrevive. |
| V.6 Un bloqueo se respeta | ✅ | **Evidencia fresca del 2026-09-15:** `buda.com` devolvió 403 de Cloudflare al verificar el enlace. No se rodeó. Quedó como `unverified` con el motivo escrito. |

### ✅ V.3 — La tabla ya no tiene huecos, pero su encabezado dice que sí

Lo revisé porque lo marcaste, y encontré lo contrario de lo esperado: **las ocho
fuentes tienen cifra medida o constancia de que no publican ninguna**, con fecha
y qué se buscó. Buda declara `max-age=2` y poleamos 450× más lento; Yahoo
`max-age=10`, 90× más lento; dolarapp y wise mandan `no-cache`, o sea que no hay
ciclo de refresco que respetar.

**Pero sobre esas filas sigue este encabezado:**

> *"Everything below this line is NOT yet verified against the source, and must
> be before its adapter ships."*

Es falso: todo lo de abajo está verificado. Y **CLAUDE.md repite el error**,
diciendo *"Sin leer: los límites de tasa de bitso, buda, binance_p2p, eldorado y
wise"* — los cinco fueron leídos.

**Deuda de documentación, no de implementación.** Es el defecto espejo del de
El Dorado: allá una afirmación decía más de lo que sabía, acá dicen menos. El
daño es distinto —hace repetir trabajo ya hecho— pero la causa es la misma:
prosa que dejó de coincidir con lo que hay.

---

## Artículo VI — Observabilidad antes que funcionalidad

| # | Estado | Dónde |
|---|---|---|
| VI.1 Toda corrida deja registro | ✅ | `db.ts:157-158` — `sources_ok` y `sources_failed`. Este último guarda `{kind, message, status, attempts}`, que separó un 504 transitorio de un bloqueo el 2026-09-14. |
| VI.2 Silencio prolongado es un error | ⚠️ | Ver abajo. |
| VI.3 La ingesta se construye y se opera antes que la interfaz | ✅ | T018 cerrada con `pg_cron` disparando y verificado antes de T021. La barrera de T020 se acotó por escrito, no se saltó. |

### ⚠️ VI.2 — Tres cosas, y la tercera es la que importa

**Primero, una corrección a la premisa de la revisión.** Se me pidió comprobar
el VI.2 *"que ensanchamos a v1.5.0"*. **No existe v1.5.0**: el constitution está
en **v1.4.0** y el VI.2 **nunca se enmendó**. Lo señalé el 2026-09-14 como
decisión pendiente del humano y no se tomó. La implementación es más ancha que
el artículo, y el artículo sigue describiendo un sistema más chico del que hay.

**Segundo, una divergencia de unidad.** El artículo mide en **corridas** —"más de
N corridas sin datos"— y `findSilentProviders` mide en **horas** (ventana de 6).
Con el cron a `*/15` son 24 corridas, más estricto que cualquier N razonable.
Pero si la cadencia bajara, seis horas podrían ser dos corridas. **Divergencia
deliberada y defendible** —lo que le importa al lector es cuánto hace que el
dato es viejo, no cuántas veces fallamos— pero no es lo que el artículo dice.

**Tercero, y esto es deuda real: el modo de falla que el propio preámbulo
nombra no está cubierto para los ocho proveedores.**

El preámbulo del Art. VI dice:

> *"El modo de falla real de este proyecto no es el crash: es el adapter que
> silenciosamente devuelve datos viejos durante semanas."*

Verificado en el código: `findSilentProviders` solo mira `captured_at` —
presencia, no contenido. `grep gross_rate silence.ts` devuelve **cero**. Hay
detección de dato congelado para `mid_market` (`inspectReference`) y para la TRM
(`inspectTrm`), **y para ningún proveedor de cotización**.

O sea: si mañana Bitso devolviera el mismo precio para siempre, las filas
seguirían llegando frescas, `check:silence` diría `Nothing is silent`, y la
interfaz mostraría un precio inmóvil con marca de "recién capturado". **Semanas,
exactamente como dice el preámbulo.**

**Deuda, con una salida barata:** la forma ya está escrita dos veces
—`inspectReference` compara valor a lo largo de corridas— y falta aplicarla por
proveedor. La cautela que hará falta es la que ya aprendimos con `stale_source`:
un precio quieto puede ser un mercado quieto, y el umbral tiene que ser por
duración, no por repetición.

---

## Artículo VII — El contrato manda

| # | Estado | Dónde |
|---|---|---|
| VII.1 El esquema antes que cualquier adapter | ✅ | T003 (migración) precede a T010–T017. `contract.ts` es T006, antes del primer adapter real. |
| VII.2 Cambiar el contrato es cambio mayor | ✅ | Cumplido en la práctica: la unión discriminada de `Quote` en T006 se consultó antes de aplicarla, y el constitution subió de versión en las cuatro enmiendas. |
| VII.3 Cada adapter con test contra respuesta real | ✅ | **18 fixtures** en `fixtures/`, todas fechadas. Los seis adapters de cotización y las dos referencias tienen la suya; TRM tiene dos —fin de semana y día hábil— porque el contraste es lo que prueba la regla. |

---

## Resumen

**No hay violación de ningún artículo.** Hay cuatro cosas que anotar, y ninguna
se maquilla:

| # | Qué | Tipo |
|---|---|---|
| 1 | **Un precio congelado de un proveedor no se detecta** (VI, preámbulo) | **Deuda** |
| 2 | **El margen está calculado y corregido, y no se muestra** (III.5) | **Deuda** |
| 3 | El encabezado de la tabla de cadencias y CLAUDE.md dicen "sin verificar" sobre datos verificados (V.3) | Deuda de documentación |
| 4 | El constitution afirma la metodología de la TRM sin fuente, y la interfaz se apartó en silencio (IV.3) | **Decisión del humano** |

La 1 es la más seria: es el modo de falla que el Artículo VI nombra en su primer
párrafo como *el* riesgo del proyecto, y está cubierto para las dos referencias y
para ninguno de los ocho proveedores.

La 4 no la puede resolver quien escribe esto: enmendar el constitution es del
humano, y las dos salidas —verificar la frase, o acotarla como se acotó I.2— son
decisiones suyas.
