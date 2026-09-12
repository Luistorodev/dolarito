# Cómo arrancar Dolarito en Claude Code

## 1. Montar el repo

```bash
mkdir dolarito && cd dolarito
git init
```

Copia el contenido de esta carpeta en la raíz del repo. Debe quedar así:

```
dolarito/
├── CLAUDE.md
├── .specify/memory/constitution.md
└── specs/001-dolarito/
    ├── spec.md
    ├── plan.md
    └── tasks.md
```

```bash
git add . && git commit -m "chore: specs iniciales"
claude
```

`CLAUDE.md` se carga solo en cada sesión: es lo que mantiene el constitution
presente sin que tengas que recordarlo cada vez.

---

## 2. Prompt inicial

Pégalo tal cual en la primera sesión.

> Vamos a construir Dolarito con Spec Driven Development. Los documentos de
> gobierno ya están escritos y son la fuente de verdad: no los reinterpretes ni
> los reescribas sin pedírmelo.
>
> Antes de escribir una línea de código:
>
> 1. Lee `.specify/memory/constitution.md`, `specs/001-dolarito/spec.md`,
>    `specs/001-dolarito/plan.md` y `specs/001-dolarito/tasks.md`.
> 2. Resúmeme en no más de diez líneas qué entendiste que vamos a construir.
> 3. Dime si encuentras contradicciones entre los cuatro documentos, o supuestos
>    que el plan da por ciertos y que convenga verificar antes de empezar.
> 4. **No empieces a implementar.** Espera mi confirmación.
>
> Reglas para toda la sesión: una tarea a la vez, con su criterio de terminado
> verificado antes de pasar a la siguiente; alto obligatorio al final de cada
> fase; y si algo contradice el constitution, me avisas en vez de resolverlo por
> tu cuenta.

El paso 3 importa: es tu última oportunidad de que un lector fresco encuentre un
error en los specs antes de que se convierta en código.

---

## 3. Prompts por fase

Uno por fase. No los encadenes.

**Fase 0 — Cimientos**
> Ejecuta T001 a T005 de `tasks.md`. Detente al terminar T005 y muéstrame el
> esquema aplicado y el resultado del test de RLS.

**Fase 1 — Contrato y orquestación**
> Ejecuta T006 a T009. En T008 quiero ver explícitamente la prueba de
> aislamiento: un adapter que lanza error junto a uno sano, y las filas del sano
> guardadas igual. Detente ahí.

**Fase 2 — Referencias**
> Ejecuta T010 y T011. Ambas escriben en `runs`, no en `quotes`. Confirma que
> `trm` y `mid_market` quedan poblados en la misma fila y en el mismo ciclo.

**Fase 3 — Adapters**
> Ejecuta T012, T013 y T014 (son paralelizables). Detente y muéstrame las filas
> generadas antes de pasar a Eldorado.

> Ahora T015. Verifica que el bracket de 1 USD queda `available: false` con
> `below_minimum` por el mínimo de 5 USD de Eldorado.

> Ahora T016. El cálculo ponderado por volumen necesita un test que compare
> contra un resultado que yo pueda verificar a mano.

> Ahora T017, que introduce el modo Remesa.

**Fase 4 — Operación**
> Ejecuta T018 y T019. Después de T019 nos detenemos: empieza T020, la ventana
> de acumulación de siete días. No inicies ninguna tarea de Fase 5.

**Fase 5 — Frontend** *(solo después de T020)*
> Se cumplió T020. Este es el resumen de hallazgos de la semana: [pegar].
> Ajusta lo que haga falta en el plan según estos datos reales, y luego ejecuta
> T021 a T023.

---

## 4. Prompts de rescate

**Si un endpoint cambió:**
> El adapter de [fuente] no responde como dice el plan. Esta es la respuesta
> real: [pegar]. No lo parchees todavía: dime qué cambió y qué opciones tenemos.

**Si el agente se adelanta:**
> Te saltaste el criterio de terminado de [tarea]. Vuelve, verifícalo y
> muéstrame la evidencia antes de seguir.

**Si propone algo que viola el constitution:**
> Eso contradice el Artículo [N]. Revísalo y propón una alternativa que lo
> cumpla, o argumenta por qué el artículo debería enmendarse.

**Revisión de fase:**
> Antes de cerrar esta fase, recorre los artículos del constitution uno por uno
> y dime cuáles se cumplen y cuáles no, con evidencia del código.

---

## 5. Si usas spec-kit

Los artefactos ya existen, así que no corras `/specify`, `/plan` ni `/tasks`:
sobrescribirían lo que ya está decidido. Instala spec-kit solo si quieres sus
comandos auxiliares, y arranca directamente con el prompt de la sección 2.

---

## 6. Pendientes antes de terminar

- **Dominio** — bloquea T030. Es el único pendiente abierto del proyecto.

## 7. Nota sobre la instalación

El zip contiene la carpeta `dolarito-specs/`. Descomprime y mueve su **contenido**
a la raíz del repo; no dejes la carpeta anidada ni copias duplicadas. Las rutas
que cita `CLAUDE.md` asumen que `.specify/` y `specs/` cuelgan directamente de la
raíz.
