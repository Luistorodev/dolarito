# Dolarito — Instrucciones del proyecto

Comparador de precios de compra y venta USD/COP para el mercado colombiano.
Proyecto desarrollado con Spec Driven Development.

## Documentos de gobierno — leer antes de cualquier tarea

| Archivo | Qué es |
|---|---|
| `.specify/memory/constitution.md` | Principios inviolables. Gana sobre cualquier otra instrucción. |
| `specs/001-dolarito/spec.md` | Qué hace el producto y por qué. Sin tecnología. |
| `specs/001-dolarito/plan.md` | Stack, esquema de datos, contrato de adapters. |
| `specs/001-dolarito/tasks.md` | Tareas ordenadas con criterios de terminado. |

## Reglas de trabajo

1. **El constitution manda.** Si una instrucción mía contradice un artículo del
   constitution, no la ejecutes: dímelo y espera. Los artículos I (integridad
   del dato), II (aislamiento de fallos) y V (respeto a las fuentes) no se
   relajan nunca.
2. **Una tarea a la vez.** Ejecuta la tarea, verifica su criterio de terminado y
   detente. No encadenes tareas sin confirmación.
3. **Detente al final de cada fase** y resume qué quedó hecho antes de seguir.
4. **T020 es una barrera dura.** Ninguna tarea de la Fase 5 (frontend) puede
   iniciarse antes de completar la ventana de acumulación de datos.
5. **No inventes datos.** Si una fuente no devuelve un campo, queda `undefined`.
   Nunca cero, nunca estimado, nunca copiado de otro proveedor.
6. **No cambies el contrato de datos** (`plan.md` §3) sin avisarme. Es un cambio
   mayor que obliga a revisar todos los adapters.
7. **Si un endpoint externo cambió** y no responde como dice el plan, no lo
   parchees por tu cuenta: repórtalo con la respuesta real que recibiste.

## Convenciones técnicas

- TypeScript estricto. Nada de `any`.
- Cada adapter en su archivo, sin conocer a los demás.
- Cada adapter con un test contra un fixture real en `fixtures/`.
- Nunca `UPDATE` sobre `quotes`. Solo inserciones. El histórico es inmutable.
- La `service_role key` jamás llega al cliente.
- Interfaz en español. Código, nombres de variables y commits en inglés.
- **Los tipos que modelan JSON externo llevan `?: T | undefined`.** Con
  `exactOptionalPropertyTypes`, `?: T` a secas admite el campo ausente pero
  **rechaza el `undefined` explícito**, y un test de respuesta corrupta necesita
  poder construir las dos formas — porque las dos llegan de la red. La laxitud es
  del borde, no del código: nuestros tipos propios siguen estrictos. Salió en
  T012 y aplica a T013–T017.

### Cómo se aplica el SQL

**DDL a mano por el SQL Editor de Supabase. DML por código con la
`service_role key`.** La línea divisoria es qué credencial hace falta:

- **DDL** — migraciones, vistas, políticas RLS, índices. El archivo se escribe
  en `supabase/migrations/` y **lo aplica el humano** pegándolo en el SQL Editor
  del dashboard. **No pidas `SUPABASE_DB_PASSWORD` ni `SUPABASE_ACCESS_TOKEN`:
  no van a estar en `.env` y no se van a agregar.** Tampoco hay Docker para un
  Supabase local. Escribí la migración, entregá el archivo, pedí la salida.
- **DML** — semillas, inserciones de ingesta, consultas de verificación. Corre
  por código contra PostgREST con la `service_role key`, que sí está en `.env`.
  Eso se automatiza y se verifica sin intervención.

Toda migración va con su script de verificación en `supabase/tests/`, fuera de
`migrations/` para que `db push` no lo levante nunca. El verificador no deja
filas y no depende del manejo de transacciones del editor.

### Tests negativos

**Un test negativo que solo comprueba "falló" no prueba nada.** Tiene que
distinguir la defensa que se quiere probar de una credencial rota, un endpoint
caído o un typo, porque los cuatro se ven igual desde afuera.

Ya pasó una vez: la primera versión de `check-rls.ts` dio los seis chequeos en
verde *antes* de que RLS existiera, porque el gateway rechazaba la `anon key`
por inválida antes de que RLS entrara en juego. Ahora arranca con un preflight
contra `/auth/v1/settings` —responde solo por validez de llave, no tiene RLS
detrás— y sale 1 con `T005 INCONCLUSIVE` en vez de mentir.

Aplica a **T019** (una fuente muda por estar caída no es lo mismo que una fuente
muda por un bug de ingesta) y a todo test que afirme una ausencia.

**Y la versión positiva: una suite en verde no es evidencia hasta que se la vio
fallar.** Antes de dar por cerrada una tarea con tests, romper la implementación
a propósito y confirmar que caen los tests correctos. Restaurar con `cmp`, no a
ojo.

También ya pasó: los cuatro primeros casos dorados de T006b pasaban igual con el
orden de comisiones invertido, porque ninguno llevaba las dos a la vez. La suite
estaba verde y el orden canónico —la regla central de `plan.md` §3.1— no estaba
probado. Lo destapó una mutación, no el verde.

## Estado actual

**Fase 0 completa, Fase 1 en curso.** Última actualización: 2026-09-13.

### Completado

- **Revisión de specs previa a implementar.** Los cuatro documentos se revisaron
  contra sí mismos; los hallazgos se incorporaron y el constitution quedó en
  **v1.2.0** (Art. III.1 reescrito sobre el lado variable, corolario I.2, y V.6
  nuevo). Hoy va por **v1.3.0**: I.2 acotó qué significa "cruda" tras la
  verificación en vivo de T008 — `jsonb` preserva el contenido, no los bytes.
  `plan.md` y `tasks.md` derivan de esa versión.
- **T001 — Inicializar monorepo.** Estructura de `plan.md` §4, workspaces de
  pnpm, TypeScript estricto, Biome, `.env.example` y `.gitignore`.
  Verificado: `pnpm install --frozen-lockfile` limpio, `pnpm lint` limpio, y una
  sonda desechable confirmó que `tsc` rechaza `any` implícito,
  `exactOptionalPropertyTypes` y accesos a índice sin verificar, y que Biome
  rechaza `any` explícito.
  También se consolidaron los specs en sus rutas canónicas (`.specify/memory/`,
  `specs/001-dolarito/`) y se borraron dos árboles duplicados idénticos.
- **T002 — Proyecto de Supabase.** Proyecto creado y `.env` local con las tres
  variables. Tres archivos nuevos en `packages/ingest/src/`:
  - `lib/env.ts` — carga el `.env` de la raíz con `process.loadEnvFile` de Node,
    sin dependencia de `dotenv`. Exige las tres variables y reporta **todas** las
    faltantes de una vez, con la ruta donde buscó. En Actions no habrá archivo y
    las variables llegarán del entorno: su ausencia no es error.
  - `lib/supabase.ts` — cliente con `service_role`, sin sesión ni refresco de
    token. Solo servidor; nunca se importa desde `apps/web`.
  - `scripts/check-supabase.ts` — el script de verificación. Enumera tablas y
    vistas leyendo el documento OpenAPI de PostgREST en `/rest/v1/`, única forma
    de listarlas teniendo solo URL y llave. No imprime material de llave.

  Verificado: `pnpm lint` y `pnpm typecheck` limpios; el script conecta contra el
  proyecto real y lista tablas, saliendo con código 0. Los dos caminos de error
  también: sin variables lista las tres y sale 1; con host inalcanzable imprime
  la causa y sale 1.

  Dependencias: `@supabase/supabase-js` 2.116.0, `@types/node` 24.13.4.

  **Decisión de build tomada acá, no en T001:** `packages/ingest` corre
  TypeScript directo con el *type stripping* nativo de Node, sin paso de
  compilación. Su `tsconfig.json` pasó a `noEmit` y sumó
  `allowImportingTsExtensions` y `erasableSyntaxOnly`; por eso los imports
  relativos llevan extensión `.ts`. Simplifica T018: no hay build antes del cron.
  `tsconfig.base.json` quedó intacto. De paso se adelantó el script `typecheck`
  que estaba previsto para T006: el bloqueo era TS18003 por cero archivos fuente.
- **T003 — Migración del esquema.** `plan.md` §2 y §2.2 completos en
  `supabase/migrations/20260913170117_initial_schema.sql`: las cuatro tablas,
  los CHECK, el índice único, los dos índices de consulta y la vista
  `latest_quotes` con el corte de 24 h y los dos márgenes. Incluye
  `market_history.loaded_at` (N5). Un diff normalizado contra `plan.md` §2
  confirmó que solo difieren dos cosas deliberadas: los índices llevan nombre
  explícito en vez del autogenerado de Postgres —las columnas no cambian— y la
  columna de N5. RLS quedó fuera a propósito: es T005.

  `supabase/tests/t003_schema_verify.sql` cubre los tres puntos del criterio de
  terminado. Aplicado a mano en el SQL Editor: la migración corrió limpia y el
  verificador devolvió `objects present, 3 rejections fired as expected`.
  Confirmado aparte con `check:supabase`, que ahora lista 5 objetos
  (`providers`, `runs`, `quotes`, `market_history`, `latest_quotes`).

  De acá salió la convención de arriba sobre DDL y DML, y con ella el descarte
  de `SUPABASE_DB_PASSWORD` y `SUPABASE_ACCESS_TOKEN`.
- **T004 — Sembrar el catálogo de proveedores.** Las 8 filas, con las
  referencias deliberadamente fuera: TRM y mid-market viven en `runs`.
  - `lib/providers.ts` — el catálogo como constante tipada. Es metadato escrito
    a mano, no dato derivado de una fuente; ningún campo de acá es un precio.
    `site_url` y las `notes` los redacté yo a partir de conocimiento general y
    de lo que dicen T014 a T017 — **revisalos**, sobre todo las URL.
  - `scripts/seed-providers.ts` — `upsert` con `onConflict: 'id'`, para que
    recorrer el seed de nuevo sea inocuo. `providers` es catálogo, no bitácora
    de observaciones: la regla de no-`UPDATE` protege a `quotes`, no a esta
    tabla. Relee de la base en vez de confiar en la escritura.

  Verificado: `pnpm seed:providers` sale 0 e imprime las 8 filas — 5 `local`
  (eldorado, dolarapp, binance_p2p, bitso, buda) y 3 `remesa` (wise, instarem,
  western_union), ninguna con `asset` o `channel` nulo.

- **T005 — Políticas RLS.** `supabase/migrations/20260913171941_rls.sql`:
  RLS activo en las cuatro tablas, **sin ninguna política**, que es el punto —
  toda lectura ocurre en el servidor y toda escritura con la llave secreta, que
  salta RLS por diseño.

  Tres cosas van más allá del texto literal de `plan.md` §2.3, ninguna cambia el
  contrato de datos:
  - **`market_history` también lleva RLS.** §2.3 nombra solo `quotes`, `runs` y
    `providers`; dejar la cuarta abierta expondría la serie sembrada a la
    `anon key` y contradice HU-07.
  - **`alter view latest_quotes set (security_invoker = on)`.** Una vista no
    lleva RLS propio: sin esa opción corre con los permisos de su dueño y le
    entrega a la `anon key` exactamente las filas que el RLS de abajo retiene.
    Era el agujero que habría dejado sin efecto todo lo demás.
  - **Se revocan los privilegios de `anon`** sobre los cinco objetos. RLS sin
    políticas devuelve conjunto vacío, no error; el revoke lo vuelve error duro.
    `authenticated` conserva sus grants y queda frenado por RLS, porque con qué
    llave leerá el tier web sigue sin decidirse (N4).

  Verificado con `pnpm check:rls`: los cinco objetos y el insert rechazados con
  `permission denied`, y la llave secreta lee las 8 filas. **El preflight contra
  `/auth/v1/settings` corre primero**, así que un verde ya no puede venir de una
  llave inválida.

  `supabase/tests/t005_rls_verify.sql` separa las dos capas, que `check:rls` no
  puede distinguir: un `revoke` solo produce el mismo `permission denied` que
  `revoke` + RLS. Corrido en el SQL Editor, confirmó las dos por separado —
  `RLS on all four tables, no policies, security_invoker on the view, no anon
  privileges`. Así que el candado no depende de una sola capa: si alguien
  volviera a otorgar privilegios a `anon`, RLS sin políticas sigue devolviendo
  conjunto vacío.

- **T006 — `contract.ts`.** `Money`, `Quote`, `Reference`, `QuoteAdapter`,
  `ReferenceAdapter` y `Adapter` en `packages/ingest/src/contract.ts`, en la ruta
  que pide `plan.md` §4.

  **`Quote` quedó como unión discriminada por `status`, no como el tipo plano
  del listado de `plan.md` §3.** Es la única forma de cumplir el criterio de
  T006: el tipo plano, con `in?` y `out?` opcionales, no puede rechazar un quote
  que dice `status: 'ok'` sin montos — justo la forma que escribiría una fila
  afirmando una observación que nunca hicimos. El contrato de datos no cambia:
  mismos nombres, mismos tipos, misma opcionalidad en todo campo que el listado
  dejaba opcional. Cambia qué *combinaciones* acepta TypeScript.

  Dos consecuencias, ambas apoyadas en la prosa de `plan.md` §2.1 pero **más
  estrictas que el listado de §3**:
  - `status: 'ok'` exige `in` y `out`, y prohíbe `limit_reason`.
  - `status: 'out_of_range'` exige `limit_reason` —una fila sin motivo no es
    accionable— y deja `in`/`out` opcionales, porque el proveedor nunca los
    cotizó. `undefined`, nunca cero (Art. I.1).

  Verificado con dos sondas desechables, borradas después: una con las formas
  válidas compila limpio y estrecha `q.out` sin cast tras `q.status === 'ok'`;
  la otra confirma que `tsc` rechaza los cinco casos malos —`ok` sin montos,
  `ok` con un solo lado, `out_of_range` sin motivo, `ok` con `limit_reason`, y
  un `status` fuera de la unión—. El primero es el criterio de T006.

- **T006b — `money.ts` con tests dorados.** `computeAmounts()` en
  `packages/ingest/src/money.ts`, única fuente autorizada para derivar montos.

  **Los cuatro casos dorados los calculó el humano a mano.** Antes de escribir
  nada los reproduje por separado con aritmética decimal exacta, no con la
  implementación: los cuatro dieron. El caso C es el que fija el redondeo —
  100/0,9901 × 3088 = 311.887,688…, que redondea a 311.888.

  **Política de redondeo, documentada en el propio archivo:** solo el lado COP
  se redondea, y una sola vez, al final. El lado USD nunca se deriva —
  `bracket_usd` denomina el lado fijo en ambas direcciones, así que sale igual
  que entró — y el USD neto o bruto que producen las comisiones es un
  intermedio que se convierte pero nunca se reporta. Mantenerlo sin redondear es
  lo que hace salir bien a C. El COP redondea al entero, mitad hacia arriba: el
  peso no tiene centavos en la práctica, y el desempate se aplica igual en las
  dos direcciones para que no favorezca a ningún proveedor.

  **N3 resuelta.** La inversa deshace la cadena al revés: suma la fija antes de
  dividir por la porcentual, `(bracket + fija) / (1 − pct)`. Hacerlo en orden
  directo subestimaría lo que la persona paga.

  **Seis casos, tres por dirección.** A–D llegaron primero; E y F se sumaron
  después de que una prueba de mutación mostrara que A–D **no fijaban el orden
  canónico en absoluto**: con una sola comisión presente, aplicar la porcentual
  antes que la fija da lo mismo que al revés, así que la regla sobre la que gira
  §3.1 quedaba sin probar. E y F llevan **las dos** comisiones, que es la única
  forma que separa los dos órdenes. Los seis los calculó el humano; los seis los
  reproduje por separado con decimales exactos antes de tocar código.

  Verificado con mutaciones deliberadas sobre `money.ts`, restaurado byte a byte
  después. Invertir el orden en directo hace fallar **E** y nada más; invertirlo
  en la inversa hace fallar **F** y nada más. Cada dirección tiene su propio
  centinela y no se tapan entre sí. La separación es 653 COP en E y 154 COP en F
  — chica, silenciosa, y ahora imposible de introducir sin que la suite lo grite.

  El test de N3 dejó de calcular su propia expectativa desde la fórmula, que solo
  probaba que el código concuerda consigo mismo. Ahora E y F sostienen la
  afirmación positiva con números del humano, y lo que queda de ese bloque es la
  mitad negativa, documental.


- **T006c — `http.ts`.** Salida de red única. Ningún adapter importa `fetch`.
  Los cuatro puntos del criterio:
  - **User-Agent (Art. V.4).** Se lee de `INGEST_USER_AGENT` y se **valida**:
    ausente, sin URL ni correo, o todavía con el marcador `.invalid` de
    `.env.example` ⇒ **error duro, no advertencia**. El Artículo V no se relaja,
    y un contacto inalcanzable delante de una fuente es justo lo que V.4
    prohíbe. Una advertencia se ignora el primer día ocupado.
  - **Timeout de 10 s**, por intento, no por llamada. Vía `AbortSignal.timeout`.
  - **Backoff exponencial (Art. V.5)** ante 429, 5xx **y 504**, y también ante
    fallo de transporte. 1000 → 2000 → 4000 ms con jitter de ±20 %, cuatro
    intentos. **`Retry-After` manda sobre nuestro horario** cuando la fuente lo
    envía: es la fuente declarando su cadencia, que es el fondo de V.3.
    Un 4xx no reintenta y no duerme: un 404 no se vuelve 200 por insistir.
  - **Cadencias declaradas (Art. V.3)**, documentadas en el propio archivo. Ver
    la salvedad en "A medias": la mitad de la tabla dice *sin verificar*, y dice
    eso a propósito.

  **Las siete mutaciones caen, ninguna sobrevive.** La que pediste explícitamente
  —reintentar sin dormir, con el reintento intacto— voltea cinco tests, porque
  cada uno afirma las tres cosas juntas: que reintentó, que durmió antes, y con
  qué números. Las otras seis: backoff lineal, 5xx fuera de reintentables,
  ignorar `Retry-After`, reintentar el 404, quitar el User-Agent, y desconectar
  el timeout de la señal.

  **La séptima encontró un defecto en mi propio test.** Con el timeout
  desconectado, el test de aborto no fallaba: **colgaba el suite entero**. Un
  cuelgue es peor señal que un rojo — en CI es un job trabado, no un reporte.
  Lleva `{ timeout: 1_000 }` y ahora sale 1 en tiempo acotado. Node lo cuenta
  como `cancelled`, no `fail`, así que **el resumen dice `fail 0` mientras el
  código de salida es 1**: mirar el código de salida, no el conteo.


- **T007 — Adapter falso.** `src/adapters/fake.ts`, en dos sabores, uno por cada
  camino que separa el Art. I.2:
  - `createFakeQuoteAdapter()` — ocho filas, dos direcciones × cuatro brackets.
    El bracket de 1 USD sale `out_of_range` / `below_minimum` en ambas
    direcciones, con el mínimo de 5 USD que imita el piso de Eldorado.
  - `createThrowingQuoteAdapter()` — lanza. **Ninguna fila**: ni un array vacío,
    ni una fila marcada como fallida. Nada. Si "no pudimos preguntar" dejara
    rastro en `quotes`, la alerta de silencio de T019 quedaría sin sentido.

  No inventa montos: pasa por `computeAmounts()` como cualquier adapter
  `computed`, así que la forma que produce es la que T008 va a tener que
  persistir de verdad. Un test lo ancla contra el caso dorado B de T006b, para
  que el falso no pueda divergir de la función compartida en silencio.

  `providerId` por defecto es `'__fake__'`, que **no** es ninguno de los ocho
  sembrados: persistir estas filas violaría la clave foránea, que es lo
  correcto. Una cotización falsa no tiene nada que hacer en `quotes`.

  Verificado con cuatro mutaciones, las cuatro atrapadas y todas con salida 1:
  montos en cero en `out_of_range`, el adapter caído devolviendo `[]` en vez de
  lanzar, una sola dirección, e ignorar el mínimo. Además un test reemplaza
  `globalThis.fetch` por una mina y exige las ocho filas igual — eso prueba que
  no toca la red, cosa que una afirmación sobre los imports no probaría.


- **N2 — RESUELTA.** `QuoteAdapter` declara `providerIds: string[]`; `wise` trae
  tres, el resto uno. El orquestador suma proveedores perdidos, no adapters
  caídos: contar adapters mide nuestro código, contar proveedores mide lo que el
  usuario deja de ver.

  El criterio de salida quedó en tres condiciones (`plan.md` §5.1), y la segunda
  es la que el humano aportó: **más de 4 de 8 perdidos, o algún modo sin ningún
  proveedor, o cualquiera de las 2 referencias caída.**

  La regla del modo vacío existe porque el conteo solo no alcanzaba. Wise sola
  pierde 3 —no supera 4, la regla 1 calla— pero esos 3 son *todo* Remesa. Para
  quien vino a comparar una remesa, un modo vacío es indistinguible de que el
  sistema no exista. Perder 4 proveedores repartidos es otra cosa: los dos
  rankings siguen respondiendo la pregunta. Un conteo no los distingue porque
  trata a los ocho como intercambiables, y pertenecen a dos productos distintos.

  Se descartó bajar el umbral a 3 para que Wise cupiera: haría saltar la alarma
  con cualquier tríada caída. La regla 2 ataca el caso por su causa real.

  **Efecto lateral registrado:** con la unidad vieja, 4 adapters de un proveedor
  caídos salían en rojo (4 > la mitad de 6); con la nueva no salen (4 no supera
  4, y ambos modos viven). Es deliberado, y tiene test propio en T008.

- **T008 — Orquestador.** `src/orchestrator.ts` y `src/db.ts`.
  `Promise.allSettled` sobre los adapters: abre la fila en `runs`, resuelve
  primero las referencias —que aterrizan en esa misma fila—, después las
  cotizaciones, y cierra con `sources_ok` y `sources_failed`.

  **Un adapter que lanza no aporta ninguna fila.** Ni vacía, ni marcada como
  fallida. Solo entra en `sources_failed` (Art. I.2). Sus hermanos sanos siguen
  guardando lo suyo: `allSettled` es justamente para que una fuente caída no
  apague a las demás (Art. II).

  La persistencia va por la interfaz `RunStore`, no por Supabase directo, así
  que la corrida entera se ejercita sin base de datos y `orchestrator.ts` habla
  de orquestación en vez de PostgREST. `db.ts` es el único que conoce PostgREST
  y donde se traduce `undefined` → `null` una sola vez (plan.md §2.1).

  **`providerIds` en la métrica, y el caso de Wise probado en las dos
  direcciones:**
  - un solo adapter caído que cubre 3 proveedores de un mismo modo **sale en
    rojo**, y el test afirma explícitamente que es por la regla 2 y **no** por
    la 1 — 3 no supera 4;
  - cuatro adapters locales caídos, 4 proveedores perdidos, **no** salen: no
    superan 4 y los dos modos siguen vivos. Con la unidad vieja esta corrida
    salía en rojo. Es deliberado.

  Cinco mutaciones, las cinco atrapadas, todas con salida 1: contar adapters en
  vez de proveedores, quitar la regla del modo vacío, dejar rastro en `quotes`
  de un adapter caído, que una referencia caída deje de ser incidente, y `>=` en
  vez de `>` en el umbral. **La tercera hubo que rehacerla:** la primera versión
  rompía la compilación, así que se "atrapaba" por error de sintaxis y no por el
  test. Una mutación que no compila no prueba nada — tiene que pasar `tsc` y
  fallar en el test.


- **Ida y vuelta en vivo contra la base real.**
  `scripts/check-db-roundtrip.ts`, corrido con `pnpm check:db`. Cubre lo que los
  tests unitarios no pueden:
  - **Las cuatro llamadas a PostgREST**: `insert` en `runs`, `update` con las
    referencias, `insert` en `quotes`, y el cierre con el resumen.
  - **Que la `service_role key` sí escribe a través de RLS.** T005 solo había
    probado que `anon` **no** puede; nunca que el servidor **sí**. Ahora las dos
    mitades están.
  - **Que `raw` sobrevive el viaje.** Con una carga adversaria a propósito:
    anidamiento, arrays, unicode con emoji, un float de nueve decimales, un
    `null` explícito, un booleano, y objeto y array vacíos.
  - De paso confirmó contra las columnas reales que `undefined` llega como
    `null` y no como cero, que era una afirmación que solo tenía test unitario.

  **La base quedó vacía.** El script cuenta antes y después y falla si no
  coinciden. Todo cuelga de una fila de `runs`, y borrarla arrastra su
  cotización por `on delete cascade`. Confirmado aparte, fuera del script:
  `runs` 0, `quotes` 0, `market_history` 0, `providers` 8 —la semilla de T004,
  que se queda—. El histórico sigue intacto porque no quedó nada que forme parte
  de él.

  **Hallazgo: `jsonb` no conserva el orden de las claves.** Las reordena por
  longitud y después alfabéticamente. Mi primera aserción comparaba
  `JSON.stringify` y falló — el defecto era de la aserción, no de `db.ts`:
  `isDeepStrictEqual` da `true` y **todos los valores están intactos**. Queda
  anotado en el script porque cambia una frase: "guardamos exactamente lo que la
  fuente mandó" es cierto del contenido, no de los bytes. Si alguna vez hace
  falta procedencia byte a byte —verificar una firma, digamos— `jsonb` es la
  columna equivocada y haría falta una de texto aparte.

- **T009 — Registro de adapters.** `src/registry.ts` exporta `ADAPTERS`.
  **Está vacío, y es el estado honesto**: los adapters reales son T010 a T017, y
  cada una agrega su línea. Los falsos están deliberadamente afuera — un falso en
  el registro de producción escribiría filas inventadas en `quotes` cada 15
  minutos, y hay un test que lo impide.

  El criterio es estructural, así que el test también: **lee el fuente de
  `orchestrator.ts`** y verifica que no importe nada de `adapters/` ni del
  registro. Afirmar la propiedad de hoy sin leer el archivo dejaría de ser cierto
  en silencio la primera vez que alguien busque un adapter concreto.

  Además `inspectRegistry()`, que no pedía la tarea pero que `providerIds` hizo
  necesario: ahora es posible que un adapter reclame un proveedor inexistente, o
  que dos reclamen el mismo. Cualquiera de las dos corrompe la métrica de
  cobertura en silencio —el fallo de N2 en su otra forma— y ninguna se ve
  leyendo un archivo. Chequea id duplicado, proveedor reclamado dos veces,
  proveedor fuera del catálogo sembrado, y adapter sin ningún proveedor.

  Tres mutaciones, las tres atrapadas: hacer que el orquestador importe un
  adapter concreto —que **compila**, `tsc` en 0, así que la atrapa el test y no
  el compilador—, y quitar cada uno de los dos chequeos de coherencia.


- **T010 — Adapter de TRM.** `src/references/trm.ts`, primer adapter real y
  primera línea en `registry.ts`.

  **La ventana de vigencia sale del dato, no de un calendario.** Cada registro
  trae `vigenciadesde` y `vigenciahasta`, y una tasa rige hasta que la releva la
  siguiente. Por eso fines de semana y festivos colombianos no son un problema:
  **no hay ni debe haber una lista de festivos en este repo**, porque la fuente
  ya dice cuánto dura su propio número.

  Verificado contra el endpoint en vivo el 2026-09-13, con dos fixtures reales:

  | vigenciadesde | vigenciahasta | días |
  |---|---|---|
  | 2026-09-12 (sáb) | 2026-09-14 (lun) | 3 |
  | 2026-09-11 (vie) | 2026-09-11 (vie) | 1 |

  **Corrección de un detalle del enunciado:** el 12 de septiembre de 2026 fue
  **sábado**, no viernes. Lo que pasó es que el registro se *publicó* el viernes
  11 a las 23:05 GMT (`x-soda2-truth-last-modified`) y *rige* desde el sábado 12.
  Publicación y vigencia son fechas distintas, que es exactamente por qué leer la
  ventana del registro gana sobre inferirla. La sustancia del enunciado era
  correcta: el registro de fin de semana llega hasta el lunes 14.

  El fixture de día hábil está como contraste, no de adorno: con
  `vigenciadesde === vigenciahasta`, un adapter que asumiera "un registro = un
  día" pasaría todos los días hábiles y estaría mal todos los sábados.

  Cuatro mutaciones, las cuatro atrapadas y las cuatro compilando. La más
  elocuente es la segunda: **calcular el día siguiente en vez de leer
  `vigenciahasta` rompe el caso de fin de semana Y el de día hábil a la vez** —
  que es la demostración de por qué el calendario está de más.

  Cumplidas las tres obligaciones nuevas: fixture real en `fixtures/`
  (Art. VII.3), línea en `registry.ts`, y la tabla de cadencias de `http.ts`
  anotada — ver abajo, porque lo que anoté es un hueco, no una cifra.


- **T011 — Adapter de tasa media de mercado.**
  `src/references/mid-market.ts`. Yahoo `USDCOP=X` primaria,
  `open.er-api.com` respaldo, y **`mid_market_src` registra siempre cuál
  respondió** — porque no son la misma medición: Yahoo es intradía, er-api es
  una foto diaria. Una serie de márgenes que las mezclara en silencio mostraría
  escalones que son de la fuente y no del mercado. La corrida en vivo lo ilustra:
  el dato de Yahoo tenía 0,4 h de antigüedad y el de er-api 20,3 h.

  **Yahoo responde 200 con el `INGEST_USER_AGENT` tal cual.** Confirmado; no hace
  falta simular navegador, y hacerlo violaría el Art. V.4.

  **El respaldo está ejercido contra la red real, no solo con stubs.**
  `scripts/check-references.ts` (`pnpm check:references`) falla a Yahoo **por
  URL** y deja salir a er-api por la red de verdad. Verde: el respaldo se
  alcanza, devuelve 3105.776374, y `mid_market_src` dice `er_api`. También cubre
  que con las dos caídas el error nombre a ambas, o el log solo acusaría al
  respaldo. Un respaldo que nunca corrió es una conjetura sobre el futuro.

  Cuatro mutaciones, las cuatro atrapadas y compilando: el respaldo mintiendo
  sobre su origen, `observed_at` pasando a ser el momento de la captura, quitar
  el respaldo entero, y dejar pasar un precio en cero.

  **Corrección a la premisa del enunciado, medida y no supuesta.** El dato de
  Yahoo **no viene congelado en el cierre del viernes** cuando el mercado está
  cerrado. El domingo 2026-09-13 el último punto venía marcado ese mismo domingo
  a las 20:00Z, mientras la última sesión cerró el 2026-09-11T22:59Z. Y tampoco
  es un reloj que corre: dos consultas con minutos de diferencia devolvieron el
  mismo `regularMarketTime`; parece un valor agrupado por intervalo.

  **Consecuencia, y toca a T019:** `mid_market_at` **por sí solo no distingue**
  "mercado cerrado" de "ingesta colgada". Un fin de semana queda minutos detrás
  de `captured_at`, no días. Lo que las separa es el par a lo largo de varias
  corridas — una ingesta colgada repite el mismo `mid_market_at` **y** el mismo
  valor, mientras un mercado cerrado puede avanzar la marca con el precio
  quieto. Sea cual sea, no se interpola nada: una tasa congelada es la respuesta
  correcta (Art. I.4).


- **T011b — Histórico de mid-market sembrado.**
  `src/references/market-history.ts` + `scripts/seed-market-history.ts`
  (`pnpm seed:history`). **518 filas, 24 meses**, de 2024-09-11 a 2026-09-11.
  Criterio cumplido con margen: pedía 6 meses.

  **La trampa de zona horaria, que es el hallazgo de esta tarea.** Yahoo marca
  cada barra diaria al *inicio* de la sesión en la zona de la bolsa, que para
  `USDCOP=X` es Europe/London. Leído como UTC a secas, un año de datos sale con
  **31 domingos y 22 viernes** — absurdo para una serie FX, y un absurdo que se
  habría sembrado en silencio sobre el histórico entero.

  Medido: de 524 barras, 152 están a 23:00Z y 110 a 00:00Z. Eso es BST y GMT, el
  mismo inicio de sesión con seis meses de diferencia. Por eso **no se usa
  `meta.gmtoffset`**, aunque en este tirón coincida en las 263 barras del último
  año: coincide solo porque +1 h deja quieta una barra de 00:00Z y empuja una de
  23:00Z al día siguiente, y esa coincidencia no es una propiedad en la que
  apoyarse. La conversión es por barra en `Europe/London`.

  La prueba de que está bien es **agregada, no fila por fila**: la serie cae
  lunes a viernes con ~104 cada uno y **cero fines de semana**. Un error así es
  invisible mirando filas sueltas.

  Los 5 festivos vienen con `close: null` y **se saltan, no se rellenan** — el
  hueco queda hueco (Art. I.4). La barra del día en curso también se excluye: una
  sesión abierta no es un cierre.

  Verificado aparte del script: 518 filas, `src` todas `yahoo_seed`, y **`runs` y
  `quotes` siguen en 0**, que era la otra mitad del criterio.


- **T012 — `bitso`, primer adapter de cotización.** `src/adapters/bitso.ts`.
  Ocho filas por corrida, `asset: 'usdt'`, `channel: 'exchange'`,
  `amounts_source: 'computed'`. La tasa no varía por monto —un ticker es un
  precio para todos— y lo que varía es el lado variable, vía `computeAmounts()`.

  **Qué lado del libro usa cada dirección, que es lo que se invierte solo:**

  | Dirección | La persona | Lado | `gross_rate` |
  |---|---|---|---|
  | `cop_to_usd` | quiere USDT, paga pesos | compra → pega al **ask** | `ask` |
  | `usd_to_cop` | entrega USDT, recibe pesos | vende → pega al **bid** | `bid` |

  Cruzarlos es silencioso y **favorece al proveedor en las ocho filas**: el `ask`
  siempre está por encima del `bid`. En el fixture están a 14,20 COP —0,46%—,
  chico para verse plausible en cada fila y grande para reordenar un ranking. Los
  tests lo fijan **por valor**: vender 100 rinde 306.550 COP, comprar 100 cuesta
  307.970, y comprar tiene que costar más de lo que rinde vender.

  **`fixed_side` por dirección, que era el criterio que más fácil se da por
  bueno.** El test no comprueba la etiqueta: comprueba que **el lado fijo sea la
  pata en USD y valga exactamente el bracket**. Una inversión pone ahí un número
  de cientos de miles en la moneda equivocada, así que no puede pasar.

  Cuatro mutaciones, las cuatro atrapadas y compilando. La inversión de
  `fixed_side` cae **en los dos sitios donde podría introducirse**: en el adapter
  (2 tests) y en `money.ts`, la fuente única (10 tests, incluidos los seis casos
  dorados). También caen `ask`/`bid` cruzados y `fee_pct: 0` en vez de
  `undefined`.

  **Cableado verificado de punta a punta contra fuentes reales**, con store en
  memoria para no tocar la base: registro → orquestador → `trm=3072.27`,
  `mid_market=3079.23 (yahoo)`, 8 filas de bitso, `sources_failed` vacío,
  `exitCode` 0.


- **La aserción del spread, ahora regla del contrato** (`plan.md` §3, regla 6) y
  parte del criterio de terminado de T013–T017. Para un mismo bracket y
  proveedor, los pesos que se pagan por N dólares deben superar a los que se
  reciben por N dólares. Es la única defensa real contra un libro invertido:
  cruzar los lados produce ocho filas impecables —tipos, `fixed_side`, monedas,
  escalado— y lo único que cambia es que el proveedor aparece mejor de lo que es.
  T016 lleva la advertencia específica del `tradeType` de Binance, invertido por
  diseño.

- **T013 — `dolarapp`** y **T014 — `buda`**, los dos `[P]` restantes del bloque
  simple. Ocho filas cada uno, `amounts_source: 'computed'`, sin comisión
  explícita en ninguno: `fee_*` queda `undefined`, nunca cero.
  - `dolarapp`: `asset: 'usdc'`, `channel: 'fintech'`. Su `date` viene con
    nanosegundos y **sin marca de zona**, así que es un timestamp flotante, no un
    instante: se preserva en `raw` y **no se parsea**, porque adivinar la zona
    sería inventar precisión que la fuente no dio.
  - `buda`: `asset: 'usdt'`, `channel: 'exchange'`. Usa `min_ask`/`max_bid`, y
    cada uno llega como **tupla `[valor, moneda]`**. La moneda se verifica, no se
    saltea: una tupla que dejara de estar en COP se leería como pesos y estaría
    mal por un tipo de cambio entero. **No trae timestamp propio** — a diferencia
    de Bitso — así que para Buda no hay reloj de la fuente contra el cual
    contrastar una respuesta vieja (nota para T019).

  **El libro delgado de Buda, medido:** 2,03% de spread contra 0,46% de Bitso en
  el mismo par el mismo minuto. Son 6.189 COP sobre una operación de 100 USD. Se
  incluye marcado, no se esconde: un spread ancho es un precio real, y ocultarlo
  favorecería al mercado.

  Cuatro mutaciones, las cuatro atrapadas y compilando. **Cruzar los lados en
  cualquiera de los dos dispara la aserción del spread**, que es exactamente para
  lo que se subió a regla. También caen dejar de verificar la moneda de la tupla
  de Buda y `fee_pct: 0` en dolarapp.

  Cableado verificado en vivo con los cinco adapters y store en memoria: 24
  filas, `sources_failed` vacío, `exitCode` 0, y la aserción del spread
  sosteniéndose contra datos reales — bitso 0,15%, dolarapp 0,87%, buda 2,04%.


### Sigue

Quedan tres adapters, y son los tres complicados:

**T015 — `eldorado`**: un POST por bracket **y por método de pago**, el único que
multiplica filas. `amounts_source: 'provider'` — su API ya usa `fixedSide`,
`amountIn` y `amountOut`. Cuidado con `fees.total[].rate` (fracción → `fee_pct`)
contra `.value` (absoluto → `fee_amount_usd`). Mínimo de 5 USD.

**T016 — `binance_p2p`**: precio ponderado por volumen, y el `tradeType`
invertido por diseño.

**T017 — `wise`**: una llamada, tres proveedores, `amounts_source: 'provider'`.
Es el que cierra la cobertura de los ocho y el que hace valer `providerIds`.

### A medias

- **Tres adapters casi idénticos.** `bitso`, `dolarapp` y `buda` comparten la
  misma forma: un par ask/bid → ocho filas. El mapeo dirección → lado del libro,
  que es la parte que se invierte sola, está escrito tres veces. El Art. II pide
  que cada adapter viva en su archivo sin conocer a los demás, y eso se respeta,
  pero **un helper compartido haría el error estructuralmente imposible en vez de
  solo detectable**, igual que `computeAmounts()`. No lo extraje: T015–T017 no
  siguen este patrón, así que conviene decidirlo cuando estén los seis y se vea
  cuánto se repite de verdad.


- **El límite de tasa de Bitso tampoco viene en la respuesta.** Verificado el
  2026-09-13 sobre un 200 en vivo de `/v3/ticker/?book=usdt_cop`: sin
  `X-RateLimit-*`, sin `Retry-After`, sin `Cache-Control`. Bitso documenta
  límites por endpoint en su referencia de API, pero **la cifra no la leí del
  cable y no la afirmo**. El ticker sí trae su `created_at`, que en esa captura
  tenía segundos: es un libro que actualiza en continuo, así que no hay ciclo de
  refresco al que ir más lento, solo un techo que no medí.


- **`market_history.close` guarda menos precisión de la que manda Yahoo.**
  Yahoo devuelve `4283.6298828125` —artefacto de coma flotante— y la columna es
  `numeric(14,4)`, así que queda `4283.6299`. Es el esquema haciendo lo que
  `plan.md` §2 define, no una invención, y 4 decimales sobre una tasa de ~4283
  COP es precisión de sobra. Se anota porque es una transformación en el borde, y
  porque **`market_history` no tiene columna `raw`**: a diferencia de `quotes`, no
  guarda la respuesta original. Lo único que preserva el crudo es el fixture.


- **Las cadencias de las dos referencias ya son cifras medidas, no descripción.**
  Yahoo manda `Cache-Control: public, max-age=10` —considera su propia respuesta
  fresca 10 segundos— y er-api `max-age=3600` más `time_next_update_unix` en el
  cuerpo, apuntando ~24 h adelante. Contra eso, nuestros 15 minutos son 90×,
  4× y 96× más lentos respectivamente. Eso ya no es un argumento desde nuestra
  cadencia: es la dirección que exige el Art. V.3, con números de la fuente.

- **El límite de tasa de datos.gov.co no está publicado en la respuesta.**
  Verificado el 2026-09-13 sobre un 200 en vivo: las únicas cabeceras
  `x-soda2-*` describen el dataset —campos, tipos, última modificación— y **no
  hay `X-RateLimit-*`, `Retry-After` ni `Cache-Control` de ningún tipo**.
  Socrata documenta un esquema de app token donde quien no se autentica comparte
  un pool limitado por IP, pero **la cifra no la verifiqué y no la afirmo**.

  Anotado así en la tabla de `http.ts`, que es lo que pide la regla de fase: o la
  cifra real con su enlace, o constancia de que no la publica, con fecha y dónde
  se buscó. Una consulta cada 15 minutos contra un dataset que cambia una vez al
  día no está cerca de ningún techo plausible, pero eso es un argumento desde
  nuestra cadencia, no desde una cifra publicada.


- **La tabla de cadencias de `http.ts` está a medio verificar, y lo dice.**
  Verificadas contra `plan.md`: TRM diaria con su ventana de vigencia en el dato,
  Yahoo hasta 1 minuto, `open.er-api.com` diaria. **Sin leer: los límites de tasa
  de bitso, buda, binance_p2p, eldorado y wise.** No inventé ninguno — donde no
  sé, la tabla dice que no sé, porque un intervalo inventado se usaría para
  justificar nuestra propia cadencia, que es el Art. I aplicado a nosotros
  mismos. Cada tarea de adapter (T012, T014, T015, T016, T017) tiene que anotar
  la cifra real ahí. Hasta entonces, los 15 minutos son demostrablemente
  conservadores contra la primera mitad de la tabla y **no** contra la segunda.


- **Los secretos del repo de T002 siguen sin ponerse, pero ya hay dónde.**
  El remoto existe: `origin` apunta a `https://github.com/Luistorodev/dolarito.git`
  y `origin/001-dolarito` está en el commit de T002. La nota anterior de este
  archivo decía que no había repositorio; quedó obsoleta durante la sesión del
  2026-09-13. Falta cargar los tres secretos en el repo. **Bloquea T018.**
- **El proyecto de Supabase arranca en frío.** La primera corrida del script en
  T002 devolvió `504 Gateway Timeout` en `/rest/v1/`; sin llave el mismo endpoint
  daba 401 estable, así que el gateway estaba arriba y lo que tardaba era la
  base. El reintento inmediato funcionó, y las corridas de T003 a T005 ya no lo
  reprodujeron. No es un fallo del código. **Ya está cubierto:** `http.ts`
  reintenta el 504 junto con 429 y el resto de los 5xx, con un test propio que lo
  nombra, así que el primer ciclo tras una pausa del proyecto ya no cuenta como
  fuente caída. Queda anotado por qué la regla existe.
- **`process.exit()` revienta en Windows con un fetch abierto.** Tira
  `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)` de libuv y el código
  de salida se pierde (3221226505). Todos los scripts usan `process.exitCode` y
  `return`. Mantenerlo así en los que vengan.
- **Biome no toca `fixtures/`.** Quería reformatear las respuestas guardadas, y
  un fixture es dato capturado, no fuente. Quedó fuera de `includes` en
  `biome.json`. Nota honesta: los fixtures están re-indentados al guardarlos, así
  que fijan **forma y valores**, no los bytes originales — la misma distinción
  que el Art. I.2 acota para `raw`.

- **Biome y `tsc` se contradicen en `process.env`.** Biome pide
  `process.env.FOO`; `tsc` exige `process.env['FOO']` por
  `noPropertyAccessFromIndexSignature` y si no falla con TS4111. Gana `tsc`: es
  el que rompe el build. `useLiteralKeys` quedó en `off` en `biome.json`, **sin
  comentario adjunto** porque `biome.json` no admite comentarios — sería
  `.jsonc`, y renombrarlo no valía el ruido. El motivo vive acá.

- **`pnpm typecheck` desde la raíz no corre.** El script hace `pnpm -r`, que
  invoca un `pnpm` que no está en el PATH — acá pnpm vive solo vía corepack.
  Correrlo por paquete: `corepack pnpm --filter @dolarito/ingest run typecheck`.
  Sin arreglar; no bloquea nada.

### Decisiones pendientes

Ninguna bloquea T008. Salieron de la revisión de specs. **N2 y N5 ya salieron de
esta lista**, resueltas y escritas en los documentos: N5 en `plan.md` §2, N2 en
`plan.md` §3 y §5.1 más el criterio de T008. Las que quedan **aún no están
reflejadas en los documentos de gobierno**.

N4 se volvió más concreta con T005: el proyecto usa el sistema **nuevo** de API
keys de Supabase, donde se pueden emitir varias llaves secretas con rol
restringido. Eso da una salida real al problema de que `service_role` también
escriba — el tier web puede tener su propia llave de solo lectura en vez de
compartir la de ingesta.

| # | Qué | Antes de |
|---|---|---|
| N1 | HU-01 quedó desfasada del Art. III.1: en `cop_to_usd` lo recibido es fijo, así que "el orden es por lo que recibo" ya no aplica. Reescribirla como "quién cobra menos pesos por los dólares que quiero". | T025 (conviene ya) |
| N3 | **Implementada y probada** en T006b: la inversa deshace la cadena al revés, y los casos dorados E y F la fijan en las dos direcciones. Lo que falta es documental: `plan.md` §3.1 sigue diciendo que el orden es "idéntico en ambas direcciones", que describe la directa y no la inversa. | Antes de T012 |
| N4 | "Clave de servidor" sin definir. La única de fábrica en Supabase es `service_role`, que también escribe: le daría escritura al tier web. Marcado en `.env.example` como `SUPABASE_SERVER_READ_KEY`. | T023 |
| — | Dominio. Único pendiente que ya venía en los specs. | T030 |

### Correcciones menores sin aplicar a los documentos

`§3.1` se usa dos
veces como número de sección; `**Reglas que todo adapter cumple:**` está
duplicado en la misma línea; T017 aparece dos veces; la estimación de "unas 64
filas" no cuenta la multiplicación por método de pago de Eldorado (~76+, sigue
siendo trivial); y "rail" sobrevive en Art. III.2, RF-05, RF-10 y T027 aunque el
esquema lo reemplazó por `asset` + `channel` — sin efecto funcional, pero T029
recorre el constitution artículo por artículo.
