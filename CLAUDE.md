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

## Estado actual

**Fase 0 en curso.** Última actualización: 2026-09-12.

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

### Sigue

**T002 — Proyecto de Supabase.** No iniciada.

### A medias

- **El commit inicial de T001 está sin hacer.** `user.name` de Git está vacío
  (el email sí está configurado). Los 23 archivos están en el índice. Falta
  decidir el nombre de autor y si el commit va sobre `master` o sobre la rama
  `001-dolarito` que sugiere `spec.md`.
- **`packages/ingest` todavía no tiene script `typecheck`.** Con cero archivos
  fuente `tsc` falla con TS18003. Se agrega en T006, junto con `contract.ts`.

### Decisiones pendientes

Ninguna bloquea T002, pero todas deben resolverse antes de la tarea que se
indica. Salieron de la revisión de specs y **aún no están reflejadas en los
documentos de gobierno**.

| # | Qué | Antes de |
|---|---|---|
| N1 | HU-01 quedó desfasada del Art. III.1: en `cop_to_usd` lo recibido es fijo, así que "el orden es por lo que recibo" ya no aplica. Reescribirla como "quién cobra menos pesos por los dólares que quiero". | T025 (conviene ya) |
| N2 | El orquestador cuenta proveedores pero ejecuta adapters. Wise es 1 adapter y 3 proveedores: una falla apaga 3 de 8 y rompe la métrica de cobertura. Falta el mapeo adapter → proveedores. | T008 |
| N3 | El orden canónico de `computeAmounts()` está descrito solo en directo. Con `fixed_side: 'out'` el cálculo corre al revés. Los casos dorados deben fijar la inversa. | T006b |
| N4 | "Clave de servidor" sin definir. La única de fábrica en Supabase es `service_role`, que también escribe: le daría escritura al tier web. Marcado en `.env.example` como `SUPABASE_SERVER_READ_KEY`. | T023 |
| N5 | `market_history` no tiene marca de carga (Art. I.3). Agregar `loaded_at` o documentar la excepción. | T003 |
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
