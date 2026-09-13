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

## Estado actual

**Fase 0 completa.** Última actualización: 2026-09-13.

### Completado

- **Revisión de specs previa a implementar.** Los cuatro documentos se revisaron
  contra sí mismos; los hallazgos se incorporaron y el constitution quedó en
  **v1.2.0** (Art. III.1 reescrito sobre el lado variable, corolario I.2, y V.6
  nuevo). `plan.md` y `tasks.md` derivan de esa versión.
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

### Sigue

**T006 — `contract.ts`.** `Money`, `Quote`, `Reference`, `QuoteAdapter`,
`ReferenceAdapter` y la unión `Adapter` de `plan.md` §3, sin cambios.

Detrás viene **T006b**, que es barrera dura: ningún adapter puede escribirse
antes de cerrarla (Art. VII.1). N3 la toca — los casos dorados tienen que fijar
también la dirección inversa, no solo la directa.

### A medias

- **Los secretos del repo de T002 siguen sin ponerse, pero ya hay dónde.**
  El remoto existe: `origin` apunta a `https://github.com/Luistorodev/dolarito.git`
  y `origin/001-dolarito` está en el commit de T002. La nota anterior de este
  archivo decía que no había repositorio; quedó obsoleta durante la sesión del
  2026-09-13. Falta cargar los tres secretos en el repo. **Bloquea T018.**
- **El proyecto de Supabase arranca en frío.** La primera corrida del script en
  T002 devolvió `504 Gateway Timeout` en `/rest/v1/`; sin llave el mismo endpoint
  daba 401 estable, así que el gateway estaba arriba y lo que tardaba era la
  base. El reintento inmediato funcionó, y las corridas de T003 a T005 ya no lo
  reprodujeron. No es un fallo del código, pero **el backoff de T006c debe cubrir
  504 además de 429 y 5xx**, o el primer ciclo tras una pausa del proyecto
  contará como fuente caída.
- **`process.exit()` revienta en Windows con un fetch abierto.** Tira
  `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)` de libuv y el código
  de salida se pierde (3221226505). Todos los scripts usan `process.exitCode` y
  `return`. Mantenerlo así en los que vengan.
- **`pnpm typecheck` desde la raíz no corre.** El script hace `pnpm -r`, que
  invoca un `pnpm` que no está en el PATH — acá pnpm vive solo vía corepack.
  Correrlo por paquete: `corepack pnpm --filter @dolarito/ingest run typecheck`.
  Sin arreglar; no bloquea nada.

### Decisiones pendientes

Ninguna bloquea T006. Salieron de la revisión de specs y **aún no están
reflejadas en los documentos de gobierno**. N5 salió de esta lista: quedó escrita
en `plan.md` §2 y ya está implementada en la migración de T003.

N4 se volvió más concreta con T005: el proyecto usa el sistema **nuevo** de API
keys de Supabase, donde se pueden emitir varias llaves secretas con rol
restringido. Eso da una salida real al problema de que `service_role` también
escriba — el tier web puede tener su propia llave de solo lectura en vez de
compartir la de ingesta.

| # | Qué | Antes de |
|---|---|---|
| N1 | HU-01 quedó desfasada del Art. III.1: en `cop_to_usd` lo recibido es fijo, así que "el orden es por lo que recibo" ya no aplica. Reescribirla como "quién cobra menos pesos por los dólares que quiero". | T025 (conviene ya) |
| N2 | El orquestador cuenta proveedores pero ejecuta adapters. Wise es 1 adapter y 3 proveedores: una falla apaga 3 de 8 y rompe la métrica de cobertura. Falta el mapeo adapter → proveedores. | T008 |
| N3 | El orden canónico de `computeAmounts()` está descrito solo en directo. Con `fixed_side: 'out'` el cálculo corre al revés. Los casos dorados deben fijar la inversa. | T006b |
| N4 | "Clave de servidor" sin definir. La única de fábrica en Supabase es `service_role`, que también escribe: le daría escritura al tier web. Marcado en `.env.example` como `SUPABASE_SERVER_READ_KEY`. | T023 |
| — | Dominio. Único pendiente que ya venía en los specs. | T030 |

### Correcciones menores sin aplicar a los documentos

`plan.md` §8 dice "enmendado a v1.1.0" (ya es v1.2.0); la URL de datos.gov.co
lleva un espacio sin codificar en `$order=vigenciadesde DESC`; `§3.1` se usa dos
veces como número de sección; `**Reglas que todo adapter cumple:**` está
duplicado en la misma línea; T017 aparece dos veces; la estimación de "unas 64
filas" no cuenta la multiplicación por método de pago de Eldorado (~76+, sigue
siendo trivial); y "rail" sobrevive en Art. III.2, RF-05, RF-10 y T027 aunque el
esquema lo reemplazó por `asset` + `channel` — sin efecto funcional, pero T029
recorre el constitution artículo por artículo.
