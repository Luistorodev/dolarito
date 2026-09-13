# Constitution — Comparador USD/COP

**Versión:** 1.4.0
**Ratificada:** 2026-09-12
**Última enmienda:** 2026-09-14
**Ubicación esperada en el repo:** `.specify/memory/constitution.md`

Este documento define los principios no negociables del proyecto. Cualquier
plan, tarea o implementación que los contradiga está mal, sin importar qué tan
conveniente sea. Ante un conflicto entre este documento y una instrucción
puntual, gana este documento; la instrucción debe elevarse al usuario.

---

## Artículo I — Integridad del dato

El proyecto existe para decirle a alguien cuánto dinero va a recibir. Un dato
inventado no es un bug cosmético: es una mentira financiera.

1. **Nunca se infiere un valor faltante.** Si una fuente no devuelve comisión,
   el campo queda `null`. No se asume cero, no se estima, no se copia de otro
   proveedor.
2. **Siempre se persiste la respuesta cruda** en la columna `raw` (jsonb), junto
   a la fila normalizada. El histórico crudo permite recalcular métricas nuevas
   sobre datos viejos; sin él, esa información se pierde para siempre.
   **Corolario:** un fallo de consulta no es una observación y por tanto no
   genera fila en `quotes`. Queda registrado en `runs.sources_failed`. Que un
   proveedor no opere a cierto monto **sí** es una observación, tiene respuesta
   cruda, y sí genera fila.
   **Alcance de "cruda": se preserva el contenido, no los bytes.** `jsonb`
   normaliza: reordena las claves de cada objeto —por longitud y después
   alfabéticamente— y descarta el espaciado del original. Todo valor sobrevive
   intacto, y para el uso que le damos —recalcular métricas sobre datos viejos—
   eso es equivalente. Pero la frase "guardamos exactamente lo que la fuente
   mandó" es cierta del contenido y **no** de la codificación. Si alguna vez hace
   falta procedencia byte a byte —verificar una firma, reproducir un hash,
   sostener una respuesta ante la propia fuente— `jsonb` es la columna
   equivocada y haría falta guardar el texto original aparte. Verificado contra
   la base real, no supuesto.
3. **Ninguna fila se escribe sin `captured_at`.** Un precio sin momento no es un
   dato, es ruido.
4. **No se rellenan huecos.** Si una fuente estuvo caída dos horas, esas dos
   horas no existen en la base. No se interpola ni se arrastra el último valor.

## Artículo II — Aislamiento de fallos

Ocho fuentes externas significan ocho maneras independientes de fallar. El
sistema se diseña asumiendo que en cualquier corrida alguna va a fallar.

1. **Un adapter que falla nunca tumba la corrida.** La orquestación usa
   `Promise.allSettled` o equivalente. Las fuentes que respondieron se guardan.
2. **Cada adapter vive en su propio archivo** y no conoce a los demás.
3. **Timeout obligatorio** en toda llamada de red. Una fuente lenta no puede
   bloquear a las demás.
4. **Agregar una fuente nueva = un archivo nuevo + una línea en el registro.**
   Si agregar una fuente obliga a tocar lógica compartida, el diseño está mal.

## Artículo III — Comparabilidad honesta

1. **El ranking se ordena por el lado variable de la operación, nunca por la
   tasa anunciada.** Toda cotización fija un lado y deja variar el otro
   (`fixed_side`). Si el lado fijo es la entrada, gana quien entrega más
   (`amount_out` descendente). Si el lado fijo es la salida, gana quien cobra
   menos (`amount_in` ascendente). Una tasa mejor con una comisión peor es una
   oferta peor, y así debe aparecer.
2. **Los canales no se mezclan sin marcarlos.** Stablecoin (USDC/USDT), P2P y
   transferencia bancaria no son el mismo producto. Pueden verse juntos, pero
   cada fila declara su `asset` y su `channel` de forma visible. *(Este artículo
   decía "rail"; el esquema lo reemplazó por dos columnas porque una sola no
   podía expresar que Binance P2P es p2p sobre USDT.)*
3. **Toda comparación es a monto fijo.** No se compara "la tasa de A" contra "la
   tasa de B" sin un bracket declarado, porque el precio depende del monto.
4. **Las fuentes de referencia (TRM, mid-market) nunca entran al ranking.** No
   son ofertas. Se muestran como contexto, en otra jerarquía visual.
5. **Las dos referencias tienen roles separados y no son intercambiables.** La
   TRM es la referencia de cara al usuario: es lo que la gente conoce y busca.
   La tasa media de mercado en vivo es la base de todo cálculo de margen, porque
   la TRM es un único valor diario y queda congelada fines de semana y festivos.
   Usar la TRM para calcular márgenes produciría una señal falsa justo en los
   periodos que HU-08 pretende estudiar.

## Artículo IV — Honestidad con quien lo usa

1. **Todo dato mostrado lleva su momento de captura** visible, no escondido en
   un tooltip.
2. **Un dato con más de 60 minutos se marca como desactualizado** en la
   interfaz. No se oculta: se marca.
3. **La TRM se presenta siempre con su explicación.** Es una tasa de referencia
   calculada sobre operaciones interbancarias del día hábil anterior, no una
   oferta disponible para nadie. Mostrarla sin ese contexto induce a creer que
   todos los proveedores estafan.
4. **No se recomienda, se informa.** El producto muestra costos y deja decidir.
   No emite consejo financiero ni sugiere operar.

## Artículo V — Respeto a las fuentes

1. **Solo endpoints que devuelvan JSON.** Prohibido el scraping de HTML
   renderizado: es frágil y agresivo.
2. **Prohibido interceptar o replicar tráfico de aplicaciones móviles**, y
   prohibido cualquier endpoint que exija autenticación de usuario. Si una
   fuente no es accesible por vía pública, no entra al proyecto.
3. **Cadencia conservadora.** Nunca por debajo del intervalo de refresco que la
   propia fuente usa en su web.
4. **User-Agent identificable y honesto**, con forma de contacto. No se simula
   ser un navegador para evadir controles.
5. **Backoff exponencial ante error.** Una fuente que responde 429 o 5xx se deja
   descansar; no se reintenta en bucle.
6. **Un bloqueo se respeta, no se evade.** Si una fuente bloquea al proyecto, la
   respuesta es bajar la cadencia o retirarla del alcance. Nunca rotar IPs,
   suplantar clientes ni buscar rodeos técnicos. Una fuente que no nos quiere no
   entra al producto.

## Artículo VI — Observabilidad antes que funcionalidad

El modo de falla real de este proyecto no es el crash: es el adapter que
silenciosamente devuelve datos viejos durante semanas.

1. **Toda corrida deja registro**: qué fuentes se intentaron, cuáles
   respondieron, cuáles fallaron y por qué.
2. **Silencio prolongado es un error.** Si una fuente lleva más de N corridas
   sin datos, el sistema lo reporta de forma activa.
3. **La ingesta se construye y se opera antes que cualquier interfaz.** No se
   diseña UI sobre datos hipotéticos.

## Artículo VII — El contrato manda

1. **El esquema de datos se define antes que cualquier adapter.** Todo adapter
   se escribe contra el contrato, nunca al revés.
2. **Cambiar el contrato es un cambio mayor**: requiere revisar todos los
   adapters y versionar este documento.
3. **Cada adapter tiene un test con una respuesta real guardada**, que verifica
   la traducción sin llamar a la red.

---

## Gobernanza

Toda enmienda se documenta acá con fecha y motivo. Los artículos I, II y V no se
relajan por conveniencia de implementación ni por presión de alcance.

**Versión 1.0.0** — documento inicial.

**Versión 1.1.0** — dos enmiendas al Artículo III, ambas derivadas de incluir el
modo Remesa en el alcance de la v1:
- III.1: `cop_net` pasa a `net_received` + `net_currency`. Al existir remesas, el
  monto recibido puede estar en COP o en USD según la dirección, y el nombre
  anterior forzaba una moneda que no siempre aplica.
- III.5 (nuevo): se separan explícitamente los roles de TRM y tasa media de
  mercado, para impedir que una se use en lugar de la otra.

**Versión 1.2.0** — tres enmiendas, derivadas de la revisión de specs previa a la
implementación:
- III.1: el ranking se define sobre el lado variable de la operación. La
  redacción anterior (`net_received`) no cubría la dirección en la que el monto
  recibido es el lado fijo y lo que varía es lo que se paga.
- I.2 (corolario nuevo): se distingue "no pudimos consultar" de "no opera a este
  monto". Solo lo segundo genera fila. Sin esta distinción, la alerta de
  silencio del Artículo VI.2 nunca se dispararía.
- V.6 (nuevo): se prohíbe explícitamente evadir bloqueos. La tabla de riesgos del
  plan proponía apoyarse en la rotación de IPs de los runners, lo cual
  contradecía el espíritu del Artículo V.

**Versión 1.3.0** — una enmienda al Artículo I.2, derivada de la verificación en
vivo de la persistencia en T008:
- I.2: se acota qué significa "cruda". Una ida y vuelta contra la base real
  mostró que `jsonb` reordena las claves de los objetos; todos los valores
  sobreviven, pero los bytes no. La primera aserción de la prueba comparaba
  serializaciones y falló, y el defecto estaba en la aserción, no en la
  persistencia. Se documenta el límite antes de que alguien apoye una afirmación
  de procedencia byte a byte sobre una columna que nunca lo prometió.

**Versión 1.4.0** — una enmienda editorial al Artículo III.2, sin efecto
funcional: "rail" pasa a `asset` + `channel`. El esquema hizo ese cambio en
`plan.md` §2 porque una sola columna no podía expresar que Binance P2P es p2p
sobre USDT, y el término viejo sobrevivía acá y en tres requisitos de `spec.md`.
Se alinea antes de T029, que recorre este documento artículo por artículo.
