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

Fase 0 pendiente. Nada implementado todavía.
