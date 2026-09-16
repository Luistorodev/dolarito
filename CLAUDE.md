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
4. **T020 es una barrera acotada** desde el 2026-09-14 — antes era total.
   Bloquea **tres decisiones de presentación**, no la Fase 5 entera: cuántos
   métodos de Eldorado se muestran, si el selector de bracket se destaca, y si
   el cruce de `binance_p2p` se explica. **T021–T024 y T026 están libres; T025
   va parcial** (ranking sí, representación de Eldorado no). El detalle y el
   motivo están en `tasks.md`, bajo T020.
   Lo que se construya mientras tanto marca lo pendiente con un **parámetro
   obligatorio sin default**, nunca con un valor provisional.
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

### Escribir archivos desde el shell

**Tres veces en dos días un script truncó CLAUDE.md a cero bytes.** Siempre el
mismo patrón: abrir el archivo en modo escritura —lo que lo vacía— y después
fallar antes de escribir nada. Las dos primeras las salvó que un humano mirara
el tamaño después. Eso no es una defensa; la tercera la atrapó `check:docs`.

**1. Nada de emojis literales en código que escribe archivos.** El primer
truncamiento fue un emoji escrito como par suplente, que Python rechaza al
codificar a UTF-8 con `UnicodeEncodeError: surrogates not allowed`. Usar el
punto de código:

```python
CHART = chr(0x1F4CA)   # bien
CHART = "\ud83d\udcca" # revienta al escribir, después de vaciar el archivo
```

**2. Nada de backticks sin escapar dentro de comillas dobles en shell.** El
segundo incidente fue un `python -c "..."` cuyo texto incluía una palabra entre
backticks: el shell la ejecutó como sustitución de comandos y la borró del
archivo, dejando una frase sin sujeto. Usar `chr(96)`, comillas simples, o un
archivo aparte.

**3. Para cualquier script de más de unas líneas, escribirlo a un archivo y
ejecutarlo**, en vez de pasarlo por heredoc. El tercer truncamiento fue eso: un
heredoc donde `\u` perdió un nivel de escape y se volvió un par suplente real.
Los heredocs largos también fallan por contenido, con un error de sintaxis del
shell que no dice cuál fue el carácter culpable.

**4. Nada de secuencias de escape con barra invertida en scripts pasados por
el shell.** `chr(92)` para la barra, `chr(96)` para el backtick. Un nivel de
escape que se pierde en el camino no da error: da otro carácter.

**7. Y en Windows, abrir en modo texto reescribe TODO el archivo.**
`io.open(p, 'w', encoding='utf-8')` traduce cada salto a CRLF, así que un
reemplazo de cinco caracteres devuelve un archivo con los finales de línea
cambiados de punta a punta. Pasó el 2026-09-15 sobre `package.json`, CLAUDE.md
y los tres workflows.

`core.autocrlf=true` lo tapa **en git** — el diff quedó en 1 línea, no en 21 —
pero **no lo tapa en disco**, y biome lee el disco: el único síntoma fue
`pnpm lint` en rojo sobre un `package.json` que nadie había reformateado. De los
cinco archivos, biome solo mira uno; en CLAUDE.md y en los `.yml` nada lo
habría dicho.

Pasar `newline=''` para leer **y** para escribir:

```python
s = io.open(p, encoding='utf-8', newline='').read()
io.open(p, 'w', encoding='utf-8', newline='').write(s)
```

Misma familia que la regla 4: una transformación invisible que no da error, da
otro archivo.

**5. Copia antes de reescribir un documento de gobierno, y verificar el tamaño
después.** `shutil.copy` antes, `wc -c` después.

**6. Y la defensa que no depende de acordarse:**

```
corepack pnpm --filter @dolarito/ingest run check:docs
```

Comprueba los cinco documentos de gobierno — piso de tamaño, secciones
obligatorias, fences y spans de código balanceados, huecos en la prosa donde el
shell se comió una palabra, y caracteres de reemplazo por encoding roto. Sale 1
si algo está dañado. Corre también en el workflow diario de `silence`, para que
un truncamiento no dependa de que alguien mire. Las reglas y el motivo de cada
una viven en `packages/ingest/src/docs-integrity.ts`.

**Dos reglas hubo que medirlas antes de confiar en ellas**, porque la primera
versión marcaba cuatro líneas sanas de CLAUDE.md: los backticks se cuentan a lo
largo del documento y no por línea —un span puede partirse en dos líneas— y los
huecos en la prosa se cuentan solo fuera de fences y de tablas, donde el conteo
medido es cero en los cinco archivos. Un chequeo que ladra sobre archivos sanos
se apaga a la semana.

**Límite conocido:** la regla del hueco excluye bloques con fence, no bloques
indentados de cuatro espacios. Acá se usan fences en todos lados, así que en la
práctica no molesta — pero código indentado con columnas alineadas se va a
marcar. Lo descubrí marcando esta misma sección.
### El tier web (Astro)

- **`output: "server"`, no estático, y no es negociable.** La puerta de T022
  no guardaría nada sobre un build estático; N4 dejó la base sin lectura
  pública, así que cada cotización se lee en el servidor con llave de
  servidor (plan.md §2.3); y con captura cada 15 minutos una foto de build
  nace vieja. El costo es una función por request, y se aceptó cuando N4
  quedó como riesgo aceptado.

- **Biome NO mira los `.astro`.** No parsea la plantilla, así que ve como no
  usadas las variables que la plantilla sí usa — marcó cuatro líneas sanas.
  Quedaron fuera de `includes` en `biome.json`, igual que `fixtures/`. **Lo
  que los cubre es `astro check`**, que es `tsc` para Astro y corre con
  `pnpm --filter @dolarito/web run typecheck`. Si se saca uno, no queda nada.

- **`astro check` no cuenta un `return` del frontmatter como uso.** Una
  variable consumida solo ahí sale como `ts(6133): declared but never read`,
  aunque el código sea correcto. Salió en `entrar.astro`. La salida es poner
  el valor en línea; anotado en el archivo para que nadie lo "arregle"
  borrando la línea que sí hacía falta.

- **El cliente de datos está escrito a mano, y es por N4.** `lib/quotes.ts`
  expone **una función y solo lee**. Un cliente de `@supabase/supabase-js` te
  da `.insert()` y `.delete()` sobre el mismo objeto con el que leés, y esa
  llave puede vaciar `quotes` — lo único irrecuperable del proyecto. Acá no hay
  superficie de escritura que usar mal.

  **Excluye `raw` del `select` a propósito:** medido, **440 KB con él contra 55
  KB sin él, el 87,6 % del payload**. La vista es `q.*`, así que `select=*` lo
  arrastra.

  **Y afirma el tope de filas aunque esté acotado por construcción.** Si la
  respuesta llega al tope, falla en vez de rankear una lista truncada. Un
  ranking truncado no es corto: es equivocado.

- **`pnpm --filter @dolarito/web run check:bundle`** construye con valores
  marcadores y los busca en **las dos superficies que llegan al navegador**:
  los assets estáticos y **el HTML renderizado**. La segunda es la que se
  olvida — con `output: 'server'` la página la genera una función, así que un
  secreto interpolado en el HTML no aparece en ningún archivo estático y un
  chequeo solo-de-assets pasaría mientras el navegador recibe la llave en cada
  request. Visto fallar con una fuga deliberada.

- **⚠️ Los secretos se leen con `process.env`, NUNCA con `import.meta.env`.**
  `import.meta.env['X']` parece leer el entorno. En el servidor de desarrollo
  lo hace —por eso tres pruebas de punta a punta pasaron— pero **en un build de
  producción Vite sustituye el valor literal**, y el secreto queda horneado en
  la función desplegada.

  Medido el 2026-09-15 construyendo con un valor marcador y buscándolo en la
  salida: aparecía en `virtual_astro_middleware.mjs` y en `entrar_*.mjs`. Con
  `process.env` no aparece en ningún lado.

  Dos consecuencias, y la segunda es la grave: cambiar la clave en Vercel no
  haría nada sin rebuild —lo que rompe el *"cambio de configuración, no de
  código"* de HU-07— y **T023 va a agregar `SUPABASE_SERVER_READ_KEY`**, que
  con el mismo error metería una credencial de base de datos dentro de un
  artefacto de build. Con N4, esa llave puede vaciar `quotes`.

  `import.meta.env.PROD` y compañía sí están bien: son constantes de build por
  diseño, no secretos. **Lo vigila `env-discipline.test.ts`**, que lee los
  fuentes y falla si alguna de las cinco variables sensibles vuelve a
  `import.meta.env`.

- **Astro trae protección CSRF de fábrica** y rechaza un POST de formulario
  sin cabecera `Origin` con 403. Apareció probando con `curl`, no en un
  fallo: si un POST de prueba da 403 y no 200, falta el `Origin`, no está
  roto el formulario.

- **Dos verificaciones de UI que corren contra HTML renderizado, no contra
  funciones.** `check:bundle` construye con marcadores y los busca en los
  assets **y en el HTML** — con `output: 'server'` un secreto interpolado en la
  página no aparece en ningún archivo estático. `check:freshness` levanta un
  PostgREST de mentira y renderiza tres escenarios de edad. Las dos se vieron
  fallar: la primera con una fuga deliberada, la segunda porque mi propio
  chequeo buscaba la palabra `desactualizado` que también está en el CSS
  inline. **Un chequeo de UI que busca texto suelto matchea su propia hoja de
  estilos**; hay que buscar la clase renderizada.

- **✅ El layout de escritorio, resuelto en T025.** Era `--measure: 34rem` para
  todo, correcto en teléfono y media pantalla vacía en un monitor. Ahora hay
  `--page-max`, que sobre 62rem pasa a 72rem y **pone las dos direcciones lado
  a lado**: comprar a la izquierda, vender a la derecha. El ancho extra sirve
  justamente a la pregunta del producto, en vez de estirar una columna.

  **Y el selector de dirección desaparece en escritorio**, porque con las dos
  visibles no le queda nada que elegir. La decisión de "uno o dos rankings"
  vive en una media query, no en un `matchMedia` del script — si viviera en los
  dos, podrían discrepar. El script solo marca `data-dir-oculta`; el CSS decide
  si eso esconde algo.

  Sin JavaScript la página sigue mostrando un ranking: el servidor renderiza el
  panel por defecto visible y el script solo cambia cuál.

- **Lo que espera datos se marca, no se decide.** `apps/web/src/lib/pending.ts`
  declara las tres decisiones de presentación como uniones **sin miembro por
  defecto**: quien las necesite tiene que recibirlas, y el sitio de llamada
  queda como el lugar visible donde alguien eligió — o como error de
  compilación hasta que elija. Es la regla 4 hecha tipo en vez de comentario.
### Una afirmación con fuente falsa es peor que una sin fuente

Porque **nadie la revisa**. Una frase sin respaldo levanta sospecha sola; una
que cita una tarea, una medición o un artículo ya pasó el filtro, y nadie la
vuelve a mirar.

Pasó el 2026-09-15. `providers.ts` decía de El Dorado:

```
notes: 'Quotes vary by payment method; 5 USD minimum (T015).'
```

**T015 midió exactamente lo contrario**: 0,5, 1 y 5 cotizan con `200`, y lo que
existe es un piso de comisión de 0,49 USDT que encarece el bracket de 1 en vez
de dejarlo fuera. La nota citaba como fuente a la tarea que la desmintió, y
sobrevivió porque la cita la hacía parecer verificada.

**De ahí sale la forma de T027:** ninguna prosa del catálogo se publica. Las
fichas **computan** lo que dicen desde las filas capturadas —asset, channel,
métodos que cotizaron, montos en que opera, si el precio cambia con el monto—.
Si una de esas frases está mal, el dato está mal, y eso es un fallo mucho más
ruidoso que una prosa equivocada.

La regla generalizable: **una cita no es una verificación.** Cuando algo dice
"(T015)" o "(medido)", o se comprueba contra lo que esa fuente dice, o se
borra la cita.

### CI: qué corre y dónde

Tres workflows, con propósitos que no se mezclan:

| Workflow | Cuándo | Qué mira |
|---|---|---|
| `verify.yml` | push a las dos ramas, y todo PR | **el código** |
| `ingest.yml` | `pg_cron` cada 15 min | captura |
| `silence.yml` | diario 13:38Z | **el estado del mundo** |

**`verify.yml` existe desde el 2026-09-15, y hasta entonces no había nada.** Los
412 tests, el lint, el typecheck y los dos chequeos de interfaz se corrían a
mano cada sesión: la única red era acordarse. Corre lint, typecheck de los dos
paquetes, los dos suites, `check:docs`, `check:bundle` y `check:freshness`.

**No usa secretos**, a propósito: así corre igual en un PR desde cualquier lado.
Lo que necesita datos vivos —`check:silence`— se queda en el diario, porque mide
el estado del mundo y no el del código.

**Ningún paso puede tragar un fallo.** Nada de `continue-on-error`, `|| true` ni
`if: always()` sobre un paso cuyo resultado es el punto. Un workflow de
verificación que pasa en verde con algo roto es peor que no tenerlo: convierte
"nadie revisó" en "alguien revisó y estaba bien".

#### La primera corrida fue roja, y encontró tres cosas distintas

Que es para lo que se escribió. Ninguna de las tres era visible en local.

**1. La identidad se exigía aunque no saliera nada a la red.** `httpRequest`
leía `INGEST_USER_AGENT` **antes de cualquier fetch**, así que un test con su
propio transporte igual pedía una identidad real. En local llegaba del `.env` de
la raíz y nadie lo veía; en CI no hay archivo y **25 tests de adapter murieron
por la variable faltante**.

La salida **no** fue poner la variable en el workflow: eso deja los tests
dependiendo de que alguien la ponga. `HttpOptions` ahora lleva `userAgent`, el
seam explícito que viaja junto a `fetchImpl`, y la validación del Art. V.4 se
extrajo a `validateUserAgent()` para que **el valor de un test pase por la misma
puerta** que el del entorno. El seam le compra a un test su identidad, nunca una
exención: hay un test que lo prueba, y **un chequeo estructural que lee los
fuentes de `adapters/`, `references/` y `scripts/`** y falla si producción usa el
seam. Mutado en las dos direcciones.

**2. Tres tests reportaron "no coincide el mensaje" y tenían razón.** Esperaban
`/no ticker/`, `/did not report success/` y `/no quote/`, recibieron el error de
variable faltante y lo dijeron. **No estaban rotos: hicieron exactamente su
trabajo.** El que estaba mal era otro — ver "Tests negativos", más abajo.

**3. El test del aborto se canceló, y no se pudo reproducir.** Ver abajo.

#### CI corre node 22; acá corre node 24. Y hay tres "node 24" distintos

Los tres workflows fijan `node-version: '22'`, así que **el node que corre
nuestro código en CI es 22.x**, no 24. Esta máquina tiene 24.13.1. Conviene
separar tres cosas que se llaman igual y no lo son:

| Cuál | Qué es | Hoy |
|---|---|---|
| `setup-node` | el node que ejecuta **nuestros scripts y tests** | **22.x** |
| El runtime de `pnpm/action-setup@v6` | el node en que corre **la action**, no nuestro código | node24 |
| Esta máquina | el node del desarrollo local | 24.13.1 |

**El segundo no dice nada sobre el primero**, y es el que confunde: que la
action corra en node24 no cambia con qué node se ejecuta `pnpm test`.

**Ningún verde local es evidencia sobre la versión que corre en CI**, ni al
revés — la misma forma de la lección del `@v5`. Para que deje de inferirse,
`verify.yml` **imprime `node --version` y `pnpm --version`** antes de instalar.

##### El `>=22` de `package.json` era falso, y ahora es `>=22.18.0`

No es cosmético. `packages/ingest` corre TypeScript directo con el *type
stripping* nativo, sin paso de compilación (decisión de T002), así que **todo
script y `node --test` dependen de que `node archivo.ts` funcione sin bandera**.
Verificado contra la documentación de Node, no de memoria:

> **v23.6.0, v22.18.0** — Type stripping is enabled by default.
> **v25.2.0, v24.12.0** — Type stripping is now stable.
>
> — `nodejs.org/api/typescript.html`, tabla de historia

Con `>=22`, un node 22.0 a 22.17 satisface el campo y **no puede correr ni un
solo script del repo**. El piso declarado decía menos de lo que el repo exige.
`'22'` en el workflow resuelve al 22.x vigente, que está por encima del piso, así
que CI nunca lo pisó — pero el campo existe justamente para quien no es CI.

**Anotado y NO cambiado:** `@types/node` está en **24.13.4** mientras CI corre
22.x. Un API que exista solo en 24 pasaría `tsc` y reventaría en CI. No se tocó
porque bajarlo a `^22` puede mover el typecheck y eso merece su propia
verificación, no ir de colado en el commit del bump.

**Lo que queda abierto:** hoy **nada verifica node 22 y node 24 a la vez**. La
salida sería una matriz en `verify.yml` — barata, el job tarda 42 s — y es lo
único que volvería *probada* la afirmación `>=22.18.0` en vez de declarada.
Decisión del humano, y deliberadamente fuera del commit del bump.

**`pnpm/action-setup@v6` ya está en los tres workflows** (2026-09-15). Estrenó
en `verify.yml` solo, y se movió a `ingest.yml` y `silence.yml` **después** de
verlo verde en las dos ramas — verify #3 en `001-dolarito` (42 s) y #4 en `main`
(38 s), sobre `10623fb`. v4 avisaba por Node 20; v6 tiene inputs idénticos a v4,
comprobado contra su `action.yml`.

**El orden importó y es el método, no el trámite:** el bump de `setup-node@v5`
también tenía inputs idénticos, también se veía seguro, y costó un día y la
ventana de T020. Un fallo en `verify.yml` cuesta un tilde rojo; uno en
`ingest.yml` cuesta la ventana. **Un parecido no es una verificación**, igual
que una cita no lo es.

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

**Y ya pasó una segunda vez, en el mismo T019 (2026-09-14).** `check:silence`
pasó en verde con el cron caído 2 h 39 min. No era un bug de cálculo: el
criterio medía **"¿el dato más nuevo es reciente?"** y la pregunta que importá
era **"¿corrió cuando debía?"**. Como solo guardaba el avistamiento más reciente
por proveedor, **cualquier caída se volvía invisible apenas aterrizaba una
corrida después** — y un disparo manual para diagnosticar el problema **borraba
la evidencia del problema**.

La forma generalizable: **preguntarle a un chequeo qué pregunta contesta, no si
da verde.** Los dos se parecen mucho cuando el sistema está sano, y se separan
exactamente cuando hace falta. Un chequeo de ausencia que solo mira el último
dato no puede distinguir "todo bien" de "estuvo muerto y volvió recién".

**Tercera vez, y esta fue un falso ROJO (2026-09-15).** `check:silence` acusó a
`wise`, `instarem` y `western_union` de no tener **ninguna fila, nunca** — los
tres habían escrito segundos antes. La consulta traía la ventana entera de una
vez, **PostgREST corta en 1000 filas**, la ventana tenía 1924, y las 924 que se
perdieron eran justo todas las de esos tres.

Dos cosas que vale separar:

- **Un falso rojo es peor que un falso verde.** Un verde que miente se cree una
  vez; un rojo que miente enseña a ignorar la alarma para siempre.
- **El defecto no era invisible: era inalcanzable.** Cuando se escribió, la
  ventana nunca pasaba de unos cientos de filas, así que ninguna cantidad de
  pruebas contra datos reales lo habría encontrado. **Apareció el día que la
  ingesta empezó a funcionar bien** — arreglar T018 fue lo que lo destapó.
  De ahí el test nuevo: un escenario de más de 1000 filas, que fija la forma
  del bug en vez de esperar a que la escala vuelva a traerlo.

El arreglo no es paginar: es **no traer filas**. Solo hace falta el último
`captured_at` por proveedor, o sea ocho consultas de una fila, que no tienen
tope que alcanzar. El costo lo fija el catálogo, no la ventana.

**Y el veredicto de `mid_market` afirmaba más de lo que el dato sostiene.**
Decía *"that is a stuck ingest, not a closed market"* mientras 26 corridas en
seis horas aterrizaban con 8 de 8 fuentes respondiendo. Lo congelado era el
dato de Yahoo a una hora sin liquidez, y guardar una tasa quieta es correcto
(Art. I.4). Ahora son **tres categorías**: mercado cerrado, **fuente vieja con
nosotros sanos**, y algo nuestro. Una fuente vieja **no** es incidente hasta las
`STALE_REFERENCE_HOURS` (12 h), porque desde la base una fuente estancada y un
adapter nuestro que cachea **se ven idénticos** — así que en vez de adivinar la
causa, escala por duración. Y cuando falta `sources_ok` no puede probar que
estábamos sanos: **ahí yerra fuerte, no callado.**
**Cuarta vez, y esta la encontró CI por accidente (2026-09-15).** Buscando por
qué tres tests reportaban un mensaje que no coincidía, salió que **había una
aserción negativa sin matcher en todo el paquete**: `trm.test.ts`, cuyo nombre
prometía *"propagates a transport failure instead of inventing a rate"* mientras
solo comprobaba que **algo** lanzara. Una credencial rota, un typo o una variable
faltante lo habrían pasado en verde igual — que es la regla de esta sección,
escrita acá desde hace días, y escrita igual sin cumplir.

Los tres que fallaron sí llevaban matcher y por eso hablaron. **El que estaba
mal fue el único que se quedó callado.**

Así que la regla dejó de depender de que alguien se acuerde:
`negative-assertions.test.ts` lee los fuentes de los tests, cuenta las 58
llamadas a `assert.rejects`/`assert.throws` y falla nombrando archivo y línea si
alguna no lleva segundo argumento. Fija además **cuántas encuentra**, porque un
chequeo que pasa en verde sobre cero llamadas ya mordió una vez en T027.

**Y la versión positiva: una suite en verde no es evidencia hasta que se la vio
fallar.** Antes de dar por cerrada una tarea con tests, romper la implementación
a propósito y confirmar que caen los tests correctos. Restaurar con `cmp`, no a
ojo.

También ya pasó: los cuatro primeros casos dorados de T006b pasaban igual con el
orden de comisiones invertido, porque ninguno llevaba las dos a la vez. La suite
estaba verde y el orden canónico —la regla central de `plan.md` §3.1— no estaba
probado. Lo destapó una mutación, no el verde.

## Estado actual

**Fase 5 completa salvo la decisión del 21.** Última actualización: 2026-09-15.
**412 tests en verde** —104 en `apps/web`, 308 en `packages/ingest`—, lint y
typecheck limpios, todo pusheado a las dos ramas.

| Fase | Estado |
|---|---|
| 0 — Cimientos | ✅ |
| 1 — Contrato y orquestación | ✅ |
| 2 — Referencias | ✅ |
| 3 — Adapters | ✅ los 8 proveedores |
| 4 — Operación | ✅ T018 y T019 cerradas; `pg_cron` dispara |
| **5 — Frontend** | ✅ T021–T028, con **T025 parcial** |
| 6 — Cierre | pendiente: T029, T030 |

**Lo único que bloquea el cierre de la Fase 5 son las tres decisiones de
presentación**, que se resuelven el **2026-09-21** con `pnpm analyse:window`.

### 🔜 Lo primero al retomar

```
corepack pnpm --filter @dolarito/ingest run check:silence
```

Debe decir **`Nothing is silent.`**. Cualquier otra cosa significa que la ventana
de T020 dejo de acumular, y eso se atiende antes que nada: **el reloj de la
ventana no corre mientras el disparador no corra** -- ya costo una semana.

Desde el 2026-09-14 el disparador es **`pg_cron`**, no el planificador de
GitHub. El porqué está en "T018 — CERRADA", más abajo.

Y el segundo comando, que desde hoy tiene su propia razón de existir:

```
corepack pnpm --filter @dolarito/ingest run check:docs
```

#### Fase 5 hecha salvo la decisión del 21

**T021, T022, T023, T024 y T026 están cerradas.** El sitio está en Vercel
detrás de la puerta, y la página imprime las 74 cotizaciones actuales desde el
servidor, con el bloque de TRM y las marcas de frescura.

**T025 está hecha en su parte rankeable.** El orden sigue el Art. III.1 y
`gross_rate` no se consulta; Eldorado queda fuera del orden con su motivo a la
vista, porque `rank()` pide la política como parámetro obligatorio y
`undefined` es el estado abierto.

**T021 a T028 están cerradas**, con T025 parcial. El 21 se resuelven las tres
decisiones de presentación con `pnpm analyse:window`, y con eso cierra la fase.

### ✅ T029: las cuatro cosas, resueltas

El checklist completo está en `specs/001-dolarito/t029-revision-constitution.md`.
**Ningún artículo estaba violado**, y las cuatro cosas encontradas se cerraron
el mismo día. Lo que dejaron como aprendizaje:

1. **Un umbral copiado es un umbral sin medir.** Para detectar un precio
   inmóvil lo obvio era reusar las 12 h de `STALE_REFERENCE_HOURS`. Medido:
   **Buda estuvo 10,8 h inmóvil, 46 corridas seguidas, comportándose normal.**
   12 h habría sido 1,1× lo medido y habría gritado en días. Quedó en **48 h**,
   4,4× el máximo, cubriendo un fin de semana que la medición no tenía.

2. **Un test puede fijar el comportamiento sin fijar la decisión.** La mutación
   que bajaba el umbral a 12 h **sobrevivió**: los tests comprobaban que 10,8 h
   no dispara, y con 12 tampoco dispara. Hizo falta un test del **razonamiento**
   —headroom mínimo sobre lo medido— para atraparla. Cuando un número es una
   decisión, el test tiene que fijar por qué es ese número.

3. **La prudencia también puede estar mal puesta.** La página de la TRM no
   afirmaba ninguna metodología, por cuidado. Pero **la fuente sí publica una**,
   en los metadatos del propio conjunto — y no haberla buscado dejó al
   constitution afirmando de memoria algo que la fuente describe distinto:
   decía "operaciones **interbancarias** del **día hábil anterior**" y la fuente
   dice "de contado", sin mencionar el día anterior. **No verificar no es lo
   mismo que no afirmar.**

El constitution quedó en **v1.6.0**: VI.2 enmendado a v1.5.0 —las tres formas de
silencio que el sistema vigila— y IV.3 a v1.6.0, citando la definición de la
fuente en vez de parafrasearla.

### ⚠️ Para tu revisión: afirmaciones sin fuente que encontré

Los `site_url` y `notes` del catálogo los escribí yo de conocimiento general.
**Ninguno se publica en las fichas** — T027 computa todo desde las filas
capturadas — pero al verificarlos aparecieron dos cosas que sí necesitan tu ojo.

**1. Una nota que era falsa y citaba como fuente a quien la desmintió.**
`eldorado.notes` decía *"5 USD minimum (T015)"*. **T015 midió lo contrario**:
0,5, 1 y 5 cotizan con 200, y lo que existe es un piso de comisión de 0,49 USDT.
Corregida en `providers.ts` y resembrada el 2026-09-15. Era peor que una
afirmación sin fuente: parecía tener una.

**2. Las ocho URL, verificadas una por una contra la red.**

| Proveedor | Resultado |
|---|---|
| El Dorado, Binance P2P, Bitso, Wise, Instarem, Western Union | 200, y el título es de la empresa correcta |
| **DolarApp** | **Redirige a `arqfinance.com`, título "ARQ"** |
| Buda | 403 de Cloudflare — no prueba nada en ninguna dirección |

**El enlace de DolarApp no se publica** hasta que lo revises: la ficha dice que
la dirección lleva a otro lado y está sin revisar. Ojo con dos cosas — el
adaptador **sigue capturando precios**, así que la API vive y lo que cambió es
el sitio o la marca; y si la marca cambió, **el nombre "DolarApp" que mostramos
también estaría desactualizado**.

Buda queda enlazado pero marcado como no comprobado. **No se rodea el bloqueo
para averiguarlo** (Art. V.6).

Las otras siete `notes` describen **nuestra propia implementación** —cómo
cotiza, de dónde viene el dato— y las respaldan las tareas que las escribieron.
Igual no se publican.

**Para levantar el sitio en local hace falta una variable que el `.env` no
tiene:** `SUPABASE_SERVER_READ_KEY`. Está cargada en Vercel pero no acá, así
que `pnpm --filter @dolarito/web run dev` muestra el aviso de "no se pudieron
leer los precios" hasta que se agregue. Por N4 su valor es hoy el mismo que
`SUPABASE_SERVICE_ROLE_KEY`.
#### Lo que sigue después: T023, T024, T026

Ninguna espera datos. La migración de `latest_quotes` ya está aplicada, así
que tienen sus columnas. T025 va parcial: el ranking sí, la representación de
Eldorado no.
### ✅ La migración de `latest_quotes` está aplicada (2026-09-14)

Aplicada y verificada en el SQL Editor con
`supabase/tests/t020_margins_and_trigger_src_verify.sql`. Llevó cuatro cosas
que caían sobre los mismos objetos, en una sola pegada:

- **Los dos defectos de los márgenes de `plan.md` §2.2, corregidos.** El
  margen sale del monto efectivo, no de `gross_rate`, y **positivo significa
  siempre peor que la referencia** en las dos direcciones. Ya no hay nada que
  implementar al cerrar la ventana: lo que queda es medir cuánto se movieron
  las cifras. La vista expone `effective_rate`, que es el número por el que
  se ordena.
- **`trm_from` y `trm_to`**, que T024 necesita para marcar la TRM congelada.
- **`mid_market_src`**, sin la cual un margen contra mid-market mezclaría en
  silencio dos mediciones distintas (T011).
- **`runs.trigger_src`**, que es lo que hace verificable la ruta de `pg_cron`.

**Un detalle que casi se escapa:** la vista hay que borrarla y recrearla, y
ese `drop` **se lleva `security_invoker` y los revokes de `anon` de T005** en
silencio — el agujero que T005 existía para cerrar. La migración los repone y
el verificador los comprueba. Olvidarlo no habría dado error: habría dado
`anon` leyendo todo.

**Nada queda pendiente del humano en la base.** T023 y T024 tienen sus
columnas.
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

  **Y en 2026-09-15 ese mismo test se canceló en CI, y NO se pudo reproducir.**
  Vale separar lo medido de lo supuesto, porque es fácil confundirlos acá:

  - **Medido:** `AbortSignal.timeout()` usa un timer *unref*'d y **no sostiene
    el bucle de eventos**. Una sonda cuyo único pendiente es esa señal sale
    *antes* de que dispare el aborto, con "unsettled top-level await" y código
    13. El mecanismo existe.
  - **No medido, y no se afirma:** que ese sea el mecanismo que rompió CI. Bajo
    `node --test` **el runner sostiene el bucle**, así que quitar el andamiaje
    sigue pasando en verde acá. Y local es node 24 contra el 22 de CI.

  Así que en vez de apostar al diagnóstico, el test **se volvió incapaz de
  colgarse**: corre contra un plazo con timer *referenciado*, que sostiene el
  bucle lo sostenga quien lo sostenga, y que **rechaza con una frase** en vez de
  dejar la promesa pendiente. Mutado con una señal que existe y nunca dispara:
  cae en 512 ms como **fallo con nombre**, `cancelled 0`.

  La diferencia importa: un test cancelado se lee como ruido de infraestructura
  y se ignora; uno rojo que dice *"the abort signal never fired"* se atiende.

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


- **T015 — `eldorado`.** `src/adapters/eldorado.ts`. **32 filas por corrida**, no
  8: es el único con dimensión de método de pago. `amounts_source: 'provider'` —
  su API ya habla nuestro contrato (`fixedSide`, `amountIn`, `amountOut`) y no se
  recalcula nada.

  **La URL faltaba en `plan.md` por completo**, y `api.eldorado.io` lleva a su API
  de socios con client credentials y KYC, que el Art. V.2 dejaría fuera. La base
  real quedó escrita en `plan.md` §3.1.

  **Dos afirmaciones del plan resultaron falsas y están corregidas:**
  - **No hay mínimo de 5 USD.** La API cotiza 0,5, 1 y 5 con `200`. Lo que hay es
    un piso de comisión de 0,49 USDT. El bracket de 1 sale **`ok` con su precio
    real** — 5.215 COP/USDT contra 3.129 a bracket 100. No está fuera de rango,
    está caro, y esconderlo tapa justo lo que HU-04 quiere mostrar.
  - **T016 tiene el problema espejo:** `insufficient_liquidity` casi nunca se va
    a disparar (260 y 347 anuncios; 1000 USDT se cubren con 1 a 3), y falta
    `below_minimum`, que sí se dispara siempre — 0 de 20 anuncios aceptan 1 USD.

  `fees.total[].rate` → `fee_pct` y `.value` → `fee_amount_usd`, cada uno a su
  columna. A bracket 100 son 0,0099 y 0,9999: parecidos en magnitud, cien veces
  distintos en significado. **La mutación que los intercambia voltea 4 tests.**

  Cinco mutaciones, las cinco atrapadas y compilando: intercambiar `rate`/`value`,
  reintroducir el mínimo inventado, invertir `fixed_side`, recortar la lista de
  métodos en silencio, y declarar `computed` cuando los montos son de la fuente.

  Tres detalles anotados en el código, ninguno representable en el contrato: la
  cotización **no es firme** (`slippageTolerancePercent: 2`), `expiresAt` está a 2
  minutos, y el `fee.value` viene con 18 decimales que un float64 no sostiene
  (`0.999899000100999899` → `0.9998990001009999`; inocuo, la columna es
  `numeric(12,4)`).

  **A Eldorado no se le redondea el COP.** Los otros tres pasan por
  `computeAmounts()`, que redondea al entero; este conserva los decimales de la
  fuente, porque redondear el número de otro es editarlo. La inconsistencia es
  deliberada y tiene test.

  En vivo, los seis adapters: **56 filas** (8+8+8+32), `sources_failed` vacío,
  `exitCode` 0, 31 s, y la aserción del spread sosteniéndose en los cuatro
  proveedores.


- **T016 — `binance_p2p`**, **T017 — `wise`**, **T018 — workflow de ingesta** y
  **T019 — alerta de silencio**. Los ocho proveedores cubiertos.
  - `binance_p2p`: ponderado por volumen, con **filtro de mínimos** que el plan
    no especificaba y decide el resultado — comprando 100 el anuncio más barato
    no califica. Dos casos dorados del humano. `below_minimum` se dispara cada
    corrida; `insufficient_liquidity` se prueba con libro recortado a propósito.
  - `wise`: una llamada, tres proveedores. **Un ausente no genera fila** — la API
    no dice por qué falta y `below_minimum` sería inferirlo.
  - `run-ingest.ts` + `.github/workflows/ingest.yml`, cron `*/15` con
    `workflow_dispatch` y `concurrency` para que una corrida lenta no se solape.
  - `silence.ts` + `check-silence.ts` + workflow diario. Distingue **ingesta
    colgada** de **mercado cerrado** por repetición de marca **y** valor a lo
    largo de corridas, que es lo único que las separa. **Y desde el 2026-09-14,
    un tercer criterio: la cadencia** — ver abajo, salió de un falso verde.

  **Primera corrida real contra la base:** 74 filas, 2 referencias, 8 de 8
  fuentes ok, exit 0, 37,5 s. `latest_quotes` devuelve rankings con márgenes.
  `check:silence` respondía "nothing is silent" — **y ese verde resultó falso**:
  el criterio de entonces no miraba la cadencia. Corregido el 2026-09-14; la
  lección vive arriba, en "Tests negativos".

  **Cinco suposiciones del plan resultaron falsas y están corregidas**, todas
  contra respuesta verificada: el mínimo de 5 USD de Eldorado, las 12 filas fijas
  de Wise, la regla 6 del spread aplicada a P2P, la monotonía del ponderado, y
  `below_minimum` faltando en Binance mientras sobraba en Eldorado.


- **T022 — Middleware de contraseña. CERRADA el 2026-09-15.**

  El interruptor tiene **tres estados** y el tercero es el que importa: una
  clave cierra, el literal `off` abre —el cambio de configuración que pide
  HU-07— y **la variable sin poner devuelve 503 sin servir nada**. Una
  variable ausente no puede significar abierto: el accidente más probable del
  periodo privado es desplegar sin ponerla, y eso publicaría el sitio en
  silencio. **Un despliegue sin la variable se cae en vez de exponerse.**

  **La cookie es un candado, no una etiqueta:** un HMAC con la clave como
  llave, comparado en tiempo constante. `autenticado=1` la pone cualquiera.

  Verificado contra un servidor real, no solo con tests: toda ruta redirige
  sin cookie, cookie inventada rechazada, la clave correcta devuelve a donde
  ibas, `volver=https://…` no saca del sitio, y los estados 503 y `off` se
  comportan. **Cinco mutaciones, las cinco atrapadas**, incluida la del `//`
  que convierte el formulario en redirección abierta.

  **Lo que los tests NO cubren, dicho para que no se crea cubierto:** que la
  comparación sea de tiempo constante. Un test no distingue `timingSafeEqual`
  de `===` sin medir, y medirlo en CI es ruido.

- **T021 — Astro + adapter de Vercel. HECHA, sin cerrar: falta el despliegue.**

  Astro 7.3.2 con `@astrojs/vercel` 11.0.10, `output: server`, tokens y
  tipografía móvil primero, layout único. `astro check` limpio, build verde,
  y **el único archivo que llega al navegador es el favicon** — verificado con
  un grep de credenciales sobre todo lo servible, porque con N4 una llave
  filtrada es la base entera.

  **La home no muestra ningún precio**, a propósito: no hay cliente de datos
  todavía y un número de ejemplo se termina creyendo (Art. I.1).

  No se cierra hasta que el despliegue exista. Los dos pasos del humano están
  arriba, en "Pendiente del humano".
### Sigue

## ⛔ T020 — Ventana de acumulación, EN CURSO

**Reiniciada el 2026-09-14. Cierre previsto: 2026-09-21.**

La fecha se corrió una semana entera porque **la ventana nunca llegó a
acumular**: del 13 al 14 el disparador no funcionó y las únicas corridas fueron
manuales. El reloj arranca de nuevo hoy, con `pg_cron` disparando y verificado
de punta a punta.

**Ninguna tarea de Fase 5 puede empezar antes de cerrarla** (Art. VI.3, regla 4
de este archivo). No es una formalidad: existe para que no se diseñe interfaz
sobre datos que todavía no se sabe cómo se comportan.

**Estado al 2026-09-16T01:15Z: 132 corridas, 9.768 filas, 50,8 h de ventana.**
La última con 8 de 8 fuentes y `sources_failed` vacío.

| Disparador | Corridas |
|---|---|
| `pg_cron` | **117** |
| `github_schedule` | 9 |
| sin etiqueta (antes de la columna) | 6 |

**`pg_cron` no se saltó un solo ciclo**: 117 corridas en los 117 ciclos de 15
minutos de sus 29,0 h, medido ciclo por ciclo. Cero huecos.

La primera lectura de los seis puntos, medida el 2026-09-14 con 3 corridas,
sigue más abajo: es la línea base contra la que se compara el 21.

### Qué revisar al cerrar la semana

`pnpm analyse:window` responde los seis. Corrible hoy; dice con cuántos datos
contó en vez de fingir confianza de una semana con dos corridas.

**Dos capturas se agregaron el 2026-09-14 porque el script descubrió que faltaban.**
Escribirlo antes del cierre fue justamente para eso:
- `runs.sources_failed` guarda `{ kind, message, status, attempts }` en vez de
  texto suelto. `HttpError` ya sabía el status y los intentos y se perdían al
  convertir a mensaje — y son lo que separa un 504 transitorio de un bloqueo.
- El `raw` de `binance_p2p` guarda el camino: `adsUsed`, `eligibleCount`,
  `eligibleCapacity` y **el desglose exacto de lo tomado por anuncio**. Sin eso
  el ponderado no siempre era reconstruible: `raw` guarda 10 anuncios y el
  camino recorre hasta 20, y medido el 13-09 la capacidad elegible dentro de los
  10 guardados era 197 USDT contra un bracket de 100 — factor de 2. Con el libro
  un poco más fino, el número dejaba de ser verificable **sin que nadie se
  enterara**. `insufficient_liquidity` ahora también registra cuánta capacidad
  había: "¿por cuánto faltó?" es pregunta de producto y no tenía respuesta.



1. **Cobertura por fuente.** Cuántas corridas de ~672 (7 días × 96) registró cada
   proveedor. Un proveedor al 95% y otro al 60% son problemas distintos: el
   primero es ruido de red, el segundo es una fuente que no sirve. Mirar también
   `runs.sources_failed` agrupado por causa — no es lo mismo un 504 que un
   cambio de formato.

2. **Huecos.** Corridas que faltan del todo (Actions encola y saltea bajo carga,
   no garantiza el `*/15`), y brackets que nunca tuvieron dato. **Atención al
   bracket de 1 USD:** hoy sale `out_of_range` en `binance_p2p` y ausente en
   `wise`/`western_union` en cada corrida. Si resulta que nunca tiene datos útiles
   en casi ningún proveedor, eso es una conclusión de producto sobre HU-04, no un
   bug.

3. **Variación entre los métodos de Eldorado.** Los 4 elegidos difieren solo en
   algunas celdas —comprando en el bracket 1, vendiendo en los grandes—. Con una
   semana se puede responder: **¿justifican 4 consultas por bracket, o colapsan
   casi siempre en un precio?** Si colapsan, se recorta la lista y baja el riesgo
   de §7.1. Si no, la asimetría de T025 es aún más importante.

4. **Frecuencia del cruce en `binance_p2p`.** Medido una vez: en el bracket 500,
   vender rendía más que comprar. Contar en cuántas corridas y en qué brackets
   pasa. Si es frecuente y sistemático, deja de ser una curiosidad y pasa a ser
   algo que la interfaz tiene que explicar (como RF-11c).

5. **Si el líder del ranking cambia según el bracket.** El script lo reporta con
   **las tres políticas de T025** —mejor método, peor método y promedio— en vez
   de asumir una. El 20 se decide T025 con este número, así que verlo de las
   tres formas es lo que lo hace decidible: si las tres coinciden, la decisión no
   afecta al ranking y se puede tomar por otros motivos; si divergen, ahí está su
   consecuencia medida. Es la pregunta que HU-04
   existe para responder. Si el líder es el mismo en los cuatro brackets, el
   selector de monto aporta poco y conviene saberlo antes de construirlo; si
   cambia, es el argumento central del producto y la interfaz debe destacarlo.

6. **Los dos defectos de los márgenes — YA CORREGIDOS el 2026-09-14.** No queda
   nada que implementar el 21. Lo que queda es **medir con la semana** cuánto
   se separa el margen anunciado del efectivo en los tres proveedores con
   comisión fija, y **cuántas filas de `cop_to_usd` cambiaron de signo**.
   Medido con 3 corridas el 14: **101 de 216 filas** cambian de signo, y la
   separación es despreciable en los de libro único (≤0,02 %) y grande donde
   hay comisión fija — wise 9,16 %, western_union 1,99 %.

#### Primera lectura — 2026-09-14, 3 corridas

Línea base contra la cual comparar el 21. **Nada de esto es concluyente con 3
corridas**, y el script lo dice solo antes de imprimir nada. Lo que ya sirve es
la *forma*, y dos puntos apuntan fuerte en una dirección.

- **1 — Cobertura.** 8 de 8 al 100 %, sin un solo fallo de adapter. Sin señal
  todavía; el valor de este punto aparece cuando algo falle.
- **2 — Huecos.** Dos, de 31 y 81 minutos, **~5 ciclos perdidos** en menos de
  dos horas. Eso no mide a las fuentes: **mide la ausencia del cron**. El
  bracket de 1 USD se comporta como se esperaba — `below_minimum` en
  `binance_p2p` las 3 veces, y cero filas en `wise` y `western_union` las 3.
- **3 — Los 4 métodos de Eldorado NO colapsan.** 14 de 24 celdas difieren. El
  spread entre métodos llega a **10,5 % comprando en el bracket de 1** y ronda
  0,6 % vendiendo en 100/500/1000. Iba a ser el argumento para recortar la lista
  y bajar el riesgo de §7.1; **el dato dice lo contrario**. Recortar borraría
  diferencias reales, así que se quedan las 4 y la asimetría de T025 pesa más,
  no menos.
- **4 — El cruce de `binance_p2p` no es una curiosidad.** 3 de 9 celdas (33 %),
  y **concentrado en los brackets grandes**: 2 de 3 en 500, 1 de 3 en 1000,
  **0 de 3 en 100**. Si se sostiene una semana, RF-11c deja de ser hipotético.
- **5 — El líder cambia, pero solo en una dirección.** Vendiendo **cambia** con
  el bracket en las 3 corridas (`binance_p2p` 9 celdas, `bitso` 3); comprando
  **nunca** cambia (`bitso` 12 de 12). Es justo la pregunta de HU-04, y la
  asimetría entre direcciones no estaba prevista.
  **Las tres políticas de T025 coinciden hoy**, porque Eldorado no lidera
  ninguna celda. Mientras siga así, **la decisión de T025 no mueve el ranking**
  y puede tomarse por legibilidad en vez de por su efecto. Si divergen en la
  semana, ahí está su consecuencia medida.
- **6 — Márgenes.** **101 de 216 filas cambian de signo** al corregir. La
  separación entre tasa anunciada y efectiva es despreciable en los tres de
  libro único (≤0,02 %) y grande donde hay comisión fija: **wise 9,16 %**,
  `western_union` 1,99 %. Confirma que el defecto no es uniforme: castiga
  exactamente a los proveedores que cobran aparte.

### Mientras tanto

**La barrera está acotada** (regla 4). **T021 y T022 ya están hechas**;
**T023, T024 y T026 se pueden hacer ya** y T025 va parcial. Lo único que espera
al 21 son las tres decisiones de presentación listadas en `tasks.md` bajo T020,
declaradas como tipos sin default en `apps/web/src/lib/pending.ts`.

La migración de `latest_quotes` **ya está aplicada**, así que T023 y T024 tienen
las columnas que necesitan y los márgenes ya están corregidos.

También sin tocar Fase 5: la asimetría de T025, las correcciones menores antes
de T029, y revisar `site_url`/`notes` del catálogo.


### A medias

- **✅ T018 — CERRADA el 2026-09-14. El disparador es `pg_cron`, no el
  planificador de GitHub.**

  Cuatro pasos en dos días. La conclusión sola se reimplementa mal, así que
  queda escrito el camino:

  1. El cron programado no corría. Se descartó el repositorio como causa —
     sintaxis, anidado del `on:`, commits recientes, rama por defecto, workflow
     deshabilitado y facturación; los seis verificados (tabla en `plan.md` §1.2).
  2. La única programada que sí disparó murió en 8 s: el **bump de actions a
     `@v5`** (`460db1a`) dejó a `setup-node` sin `pnpm`. La variable no era
     programada-contra-manual: era **v4 contra v5**. Arreglado con
     `pnpm/action-setup` antes de `setup-node`, en los dos workflows.
  3. Ya arreglado, el planificador seguía descartando el **~97 %** de los
     disparos. Se movió el cron fuera de los minutos redondos como hipótesis
     declarada, con **criterio de decisión escrito por adelantado**. Se cumplió.
  4. El disparador pasó a **`pg_cron` + `pg_net` → `workflow_dispatch`**.

  **Por qué esa forma y no una Edge Function:** el *runner* de GitHub funciona
  — 44 s, verde, 8 de 8 fuentes. Lo que falla es el *planificador*. Mover el
  trabajo a Deno habría cambiado el runtime que los 260 tests ejercitan, y los
  logs de Actions por un visor más pobre: cambiar lo que anda para arreglar lo
  que no.

  Verificado con `supabase/tests/t018_pg_cron_verify.sql`: job activo, secreto
  legible en Vault, disparo `succeeded`, **GitHub respondió 204**, y una fila
  quedó etiquetada `pg_cron`. Las dos rutas vistas en verde, que era el criterio.

  **Lección, la de este archivo aplicada a CI:** subir una action de major es un
  cambio que necesita su propia verificación. Un verde anterior es evidencia
  sobre la versión anterior y sobre ninguna otra.

- **✅ T019 — CERRADA el 2026-09-14, después de dos falsos verdes propios.**

  Tres criterios, y los dos últimos existen porque el chequeo pasó en verde
  mientras el sistema estaba roto:
  1. Un proveedor sin filas en la ventana.
  2. Una referencia congelada — marca **y** valor repetidos, lo único que separa
     ingesta colgada de mercado cerrado.
  3. **La cadencia.** Pasó verde con el cron caído 2 h 39 min: medía "¿el dato
     más nuevo es reciente?" cuando la pregunta era "¿corrió cuando debía?". Y
     un disparo manual para diagnosticar **borraba la evidencia del problema**.

  Dentro del tercero, un cuarto arreglo: **mira una corrida más allá del borde
  de la ventana**, porque un hueco que empieza antes y termina dentro era
  invisible. Verificado en vivo — el hueco de 375 min apareció donde antes no
  había nada.

- **✅ CERRADO el 2026-09-16: el `schedule:` de `ingest.yml` se retiró.**

  Convivieron dos rutas desde el 14 con un propósito declarado: que
  `trigger_src` contara cuánto aportaba cada una. Contó, y la respuesta fue
  cero.

  **`ingest.yml` ya no tiene `schedule:`.** Queda `workflow_dispatch` solo,
  que es por donde entra `pg_cron` **y** el disparo manual. La cadencia ya no
  vive en el repositorio: vive en el job de `pg_cron`.

  **Medido el 2026-09-16, y el número contesta la pregunta:**

  | | |
  |---|---|
  | Ciclos de 15 min con `pg_cron` en la ventana | **117** |
  | Ciclos que `pg_cron` se saltó | **0** |
  | Corridas de `github_schedule` | **9** |
  | De ésas, en un ciclo que `pg_cron` **ya** había cubierto | **9 de 9** |
  | De ésas, en un ciclo que `pg_cron` **no** cubrió | **0** |

  **Nunca, ni una vez, cubrió algo.** Las 9 cayeron entre 0,7 y 13,5 minutos
  después de una corrida de `pg_cron` del mismo ciclo, así que las ocho fuentes
  recibieron dos visitas en menos de 15 minutos en cada una.

  Y sigue igual de degradado: 9 corridas en 28,4 h contra los ~114 ciclos que le
  tocaban, o sea **7,9 %**. Que subiera de 3 a 9 no lo mejora como respaldo —
  un respaldo que cubre 1 de cada 13 ciclos no es un respaldo.

  **El costo, en la unidad que importa (§7.1):** El Dorado recibe **32 POST por
  corrida** — 4 métodos × 4 brackets × 2 direcciones, uno por celda, y es el
  único proveedor con una consulta por celda. Las 9 corridas duplicadas le
  costaron **288 POST que no compraron ni una fila nueva**, un 7,1 % de más
  sobre los 4.032 de la ventana. Eso es exactamente lo que el Art. V.3 pide no
  hacer: tráfico que no responde ninguna pregunta.

  **El argumento de "respaldo gratis" ya no se sostiene, y es medible:** no es
  gratis — cuesta 32 POST a El Dorado cada vez que dispara — y no es respaldo
  — nunca cubrió un ciclo que `pg_cron` fallara, entre otras cosas porque
  `pg_cron` no falló ninguno.

  #### Qué revertiría esta decisión, y cómo se mide

  **La condición:** que `pg_cron` empiece a saltarse ciclos. Hoy el registro es
  **0 de 117**; la decisión se apoya entera en ese número y cae con él.

  **Umbral, para que no se decida por impresión como la vez pasada:** más de
  **un ciclo perdido por día** sostenido dos días seguidos. Uno suelto es la
  clase de cosa que pasa; el patrón es lo que importa. Está elegido sobre lo
  medido — 0 en 29 h — así que cualquier reaparición ya es señal, y **si se
  revisa con más ventana hay que remedirlo**, no heredarlo (la lección del
  umbral copiado, T029).

  **Cómo se mide — ya existe, en dos sensibilidades distintas, y conviene no
  confundirlas:**

  | Qué | Detecta | Cuándo corre |
  |---|---|---|
  | `pnpm analyse:window`, punto 2 | huecos **> 22,5 min**, o sea **un solo ciclo perdido**, con el conteo | a mano |
  | `check:silence` | solo huecos **> 60 min** (`TOLERATED_GAP_MINUTES`), o sea 3 ciclos o más | diario, automático |

  **El diario NO sirve para esta decisión**, y por eso está la tabla: sus 60
  minutos se calibraron cuando el disparador era el planificador de GitHub, que
  encola y descarta corridas — la tolerancia describe un componente que ya no
  está en el camino. Con `pg_cron` en 0 de 117, un ciclo perdido ya es anómalo y
  la alarma diaria no lo va a decir. **Para el criterio de arriba se mira
  `analyse:window`.**

  Queda anotado como candidato a remedir: si `pg_cron` sostiene su récord una
  semana, `TOLERATED_GAP_MINUTES` está describiendo un sistema que ya no
  existe. No se tocó ahora porque un umbral se mide antes de cambiarlo.

  **Volver atrás son dos ediciones, no una**, y están escritas en la cabecera
  de `ingest.yml`: reponer el bloque `schedule:` **y** reponer la expresión de
  `INGEST_TRIGGER`. Sin la segunda, todas las corridas quedarían etiquetadas
  con el default de `inputs.trigger` y la columna que hizo medible esta
  decisión dejaría de distinguir las dos rutas.

  ```sql
  select trigger_src, count(*), min(started_at), max(started_at)
  from runs group by trigger_src order by 2 desc;
  ```

  **La decisión se toma con ese conteo, no con impresiones.** Ni "parece que ya
  anda" ni "parece que sigue roto": razonar así es lo que hizo perder dos días
  acá, y ahora hay una columna que lo contesta.

  A favor de retirarlo: una sola ruta es más simple, y el doble disparo duplica
  el tráfico a las ocho fuentes — toca el Art. V.3 y el riesgo de Eldorado de
  §7.1. A favor de dejarlo: es respaldo gratis si `pg_cron` cae, y hoy ninguna
  ruta tiene red.

  **Nota de atribución, medida:** en la UI de Actions un despacho de `pg_cron`
  aparece como *"Manually run by (dueño del PAT)"*, porque GitHub lo atribuye a
  quién firma el token. **Desde Actions las dos rutas son indistinguibles.**
  `trigger_src` es el único lugar donde vive la respuesta, y es el mejor
  argumento a favor de esa columna.

- **`quotes.gross_rate` también es `numeric(14,4)`, y eso produjo una falsa
  alarma.** Verificando que el ponderado de `binance_p2p` se reconstruye desde
  el `taken` que ahora guarda `raw`, **tres filas dieron "DIFIERE"**. No era un
  defecto del camino recorrido: **era la columna**. Las diferencias iban de 1e-5
  a 2,6e-5 — medio ulp de 4 decimales — y la tolerancia de mi comprobación era
  más fina que la precisión que la base puede guardar.

  La reconstrucción es **exacta en memoria y exacta a 4 decimales** a través de
  la base. Queda anotado en el test porque la lección se reaplica sola en enero:
  **una verificación más precisa que su propia columna se acusa a sí misma.**
  Misma familia que la nota de `market_history.close` de arriba.

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


- **✅ La tabla de cadencias de `http.ts` está completa.** Esta nota decía lo
  contrario —"sin leer: bitso, buda, binance_p2p, eldorado y wise"— y era falsa:
  **las ocho fuentes fueron leídas del cable el 2026-09-13**, cada una con fecha
  y con qué se buscó. Buda declara `max-age=2` y poleamos 450× más lento; Yahoo
  `max-age=10`, 90× más lento; dolarapp y wise mandan `no-cache`, o sea que no
  hay ciclo de refresco que respetar; TRM, bitso, eldorado y binance_p2p no
  publican límite, y eso queda anotado como ausencia verificada, no como hueco.

  **El encabezado de la propia tabla repetía el error** y decía que todo lo de
  abajo estaba sin verificar. Corregido en T029. Es el defecto espejo del de El
  Dorado: allá una afirmación decía más de lo que sabía, acá menos — y el daño
  de decir menos es hacer repetir trabajo ya hecho.


- **✅ Los secretos del repo están cargados.** Esta nota decía *"siguen sin
  ponerse"* y *"bloquea T018"*, y era falsa desde hacía días: T018 está cerrada
  y `pg_cron` despacha el workflow cada 15 minutos con éxito. Si faltara
  cualquiera de los cuatro secretos, cada corrida fallaría. **El sistema
  funcionando es la prueba**, y la nota sobrevivió igual — tercer caso en dos
  días de prosa que dejó de coincidir con el repo.
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

### Decisiones cerradas durante T020

- **Helper compartido para los tres adapters simples — NO se extrae.** Decidido
  el 2026-09-14 con los seis a la vista.

  El bloque duplicado existe y es real: ~25 a 30 líneas casi idénticas en
  `bitso`, `dolarapp` y `buda`. Pero **el criterio era que hiciera el error
  imposible, no que ahorrara líneas**, y no lo logra.

  El error que preocupa es invertir el mapeo dirección → lado del libro. Un
  helper tendría que recibir los dos precios ya clasificados —`buyRate` y
  `sellRate`—, así que la decisión de cuál campo del proveedor es cuál **sigue
  en el adapter**: es conocimiento de la fuente y no puede vivir en otro lado.
  El error no desaparecería, se mudaría al sitio de llamada.

  Y lo que sí era mecánico **ya está centralizado**: `fixed_side` sale de
  `computeAmounts()`, no de cada adapter. La prueba está medida — invertirlo ahí
  voltea 10 tests, incluidos los seis casos dorados.

  Lo que queda duplicado es armado de objeto: identidad del proveedor y un bucle
  doble. Extraerlo serviría a 3 de 6 —`eldorado`, `binance_p2p` y `wise` no
  siguen este patrón en nada— a cambio de un acoplamiento que el Art. II.2 pide
  evitar.

  **La defensa correcta ya está en su capa:** la aserción del spread, que es
  regla del contrato (`plan.md` §3) y obligatoria para los adapters de libro
  único — exactamente los tres en cuestión. Detecta la inversión por valor en
  cada uno, y las mutaciones lo confirmaron en los tres.

- **N4 — RIESGO ACEPTADO, no resuelta.** El dashboard de Supabase **no permite
  atar una llave a un rol**: el formulario solo pide Name y Description, y avisa
  que toda secret key da acceso elevado y salta RLS. Verificado el 2026-09-14.

  **El tier web va a leer con `service_role`, que también escribe, borra y hace
  DDL.** Un servidor comprometido podría vaciar `quotes`, y el histórico es lo
  único irrecuperable del proyecto. Escrito sin suavizar en `plan.md` §2.3 y en
  la tabla de riesgos de §7.

  El rol `web_reader` **queda creado como preparación, inerte**, y se activa si
  Supabase permite asociar llaves a roles **o** si el acceso pasa a Postgres
  directo en vez de PostgREST — esta segunda no depende de que nadie cambie
  nada, pero tiene costo de pool de conexiones.

  **Dos mitigaciones a evaluar en T021**, ninguna de las cuales lo resuelve: que
  el servidor solo consulte `latest_quotes`, y que la llave viva únicamente en
  variables de entorno del hosting.

  Lo que sigue debajo describe el rol y por qué está escrito así.

  El riesgo que cierra: `service_role` no solo lee — escribe, borra y hace DDL.
  Dárselo a un sitio que únicamente hace `SELECT` significa que una falla del
  servidor web puede vaciar `quotes`, y el histórico es lo único irrecuperable
  del proyecto.

  `supabase/migrations/20260913234154_web_reader_role.sql` crea el rol con
  `SELECT` sobre **`latest_quotes`, `providers` y `market_history`**, y nada
  más. `quotes` y `runs` quedan fuera a propósito: la interfaz nunca necesita
  filas crudas —usa la vista, que ya aplica el corte de 24 h— y exponer `quotes`
  expondría además cada `raw` que guardamos. Sin privilegios por defecto sobre
  tablas futuras: una tabla nueva es invisible para este rol hasta que alguien
  la conceda a propósito.

  Como la vista corre con `security_invoker` (T005), el rol necesita políticas
  RLS de solo lectura en las tablas de abajo o la vista le devolvería vacío.
  Están en la migración, con el motivo escrito: acá no hay privacidad por fila
  que imponer —toda fila es un precio público— y la protección del periodo
  privado está en la puerta (HU-07), no por fila.

  **Falta un paso que no es SQL:** crear la llave secreta y atarla al rol desde
  el dashboard. Eso no lo puedo verificar yo. **Si el dashboard no ofrece atar
  una llave a un rol**, el repliegue es seguir con `service_role` solo del lado
  servidor y **anotarlo como riesgo aceptado**, no darlo por resuelto — la
  diferencia importa porque cambia qué puede hacer un servidor comprometido.

  `supabase/tests/n4_web_reader_verify.sql` comprueba las dos mitades: que el rol
  **puede** leer la superficie de la UI y que **no puede** escribir en ningún
  lado ni tocar las tablas crudas. Sin correr todavía — es DDL, va por el SQL
  Editor.

### Decisiones pendientes

**Las cinco numeradas están cerradas.** N1, N2, N3, N4 y N5 salieron de esta
lista y están escritas en los documentos de gobierno, no solo acá:

| # | Dónde quedó |
|---|---|
| N1 | `spec.md` HU-01, reescrita sobre el lado variable (Art. III.1) |
| N2 | `plan.md` §3 y §5.1, más el criterio de T008 |
| N3 | `plan.md` §3.1, que ahora describe la cadena inversa además de la directa |
| N4 | `plan.md` §2.3 vía la migración de `web_reader`, y `.env.example` |
| N5 | `plan.md` §2, implementada en la migración de T003 |

Queda una sola, y venía de los specs originales:

| # | Qué | Antes de |
|---|---|---|
| — | Dominio. | T030 |

Las que se abrieron durante la implementación están arriba, en "A medias" y en
la revisión de cierre de T020: la asimetría del ranking de Eldorado
(`[NECESITA DECISIÓN]` en T025). Los dos defectos de los márgenes **ya están
corregidos** — ver "La migración de `latest_quotes` está aplicada", arriba.

### Correcciones menores — todas aplicadas (2026-09-14)

Ninguna pendiente. Se cerraron antes de T029, que recorre el constitution
artículo por artículo:

- `§3.1` duplicado como número de sección → la tabla por fuente pasó a
  `#### Notas por fuente`, sin numerar, para no romper nueve referencias
  cruzadas en documentos y código.
- `**Reglas que todo adapter cumple:**` duplicado en la misma línea.
- T017 aparecía dos veces en `tasks.md`; el bloque de continuación se fusionó.
- La estimación de "unas 64 filas" → **74 medidas** en la primera corrida real.
  La diferencia es Eldorado, que aporta 32 él solo.
  **Corregido a medias, detectado el 2026-09-14:** se había aplicado en
  `plan.md` pero no en `tasks.md` T023, mientras este encabezado decía "todas
  aplicadas". Ya está en los dos. La lección es del encabezado, no de la cifra:
  **"todas aplicadas" es una afirmación verificable y no se escribe sin
  verificarla en cada archivo que la corrección tocaba.**
- "rail" sobrevivía en Art. III.2, RF-05, RF-10, RF-15 y T027 → `asset` +
  `channel`. El constitution subió a **v1.4.0** por esa enmienda, que es
  editorial y sin efecto funcional.
