# Constitution — Comparador USD/COP

**Versión:** 2.0.0
**Ratificada:** 2026-09-12
**Última enmienda:** 2026-09-17
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
3. **La TRM se presenta siempre con su explicación.** Es una tasa de
   referencia, no una oferta disponible para nadie. Mostrarla sin ese contexto
   induce a creer que todos los proveedores estafan.

   La fuente la define así, y es la única definición que este proyecto afirma:

   > «La Tasa de Cambio Representativa del Mercado–TRM corresponde al promedio
   > ponderado de las operaciones de compra y venta de contado de dólares de los
   > Estados Unidos de América a cambio de moneda legal colombiana.»
   > — Metadatos del conjunto `32sa-8pi3` en datos.gov.co, atribuido a la
   > Superintendencia Financiera de Colombia. Leído el 2026-09-15.

   *(Esta cláusula decía "calculada sobre operaciones **interbancarias** del
   **día hábil anterior**". Verificado contra la fuente en T029: dice "de
   contado", no interbancarias, y no dice nada del día hábil anterior. Las dos
   precisiones se escribieron de memoria antes de que existiera un adapter y se
   retiraron por eso.)*
4. **No se recomienda, se informa.** El producto muestra costos y deja decidir.
   No emite consejo financiero ni sugiere operar.

## Artículo V — Respeto a las fuentes

> **Enmendado en v2.0.0 (2026-09-17).** Los incisos 1, 2, 4 y 6 se relajaron para
> admitir fuentes raspadas por intermediario. **El inciso 6 es el que cambia de
> naturaleza**, no solo de grado: las otras tres eran nuestra propia vara de
> calidad; ésa era sobre la voluntad de un tercero. Qué se cedió, con qué
> evidencia y qué lo revertiría está en Gobernanza. Acá está la regla vigente.

1. **Se prefiere un endpoint que devuelva JSON**, y donde exista uno público es
   obligatorio usarlo. Es la única forma en que un campo tiene nombre y tipo en
   origen. **El scraping de HTML renderizado deja de estar prohibido** y pasa a
   estar condicionado: se admite bajo el inciso 7, con las obligaciones del 8 y
   la política de retiro del 9. Sigue siendo frágil; lo que cambia es que ahora
   la fragilidad se declara y se vigila en vez de excluirse.
2. **Prohibido interceptar o replicar tráfico de aplicaciones móviles**, y
   prohibido cualquier endpoint que exija autenticación de usuario. **Una fuente
   sin API pública sí puede entrar** cuando su tasa es visible en su web abierta,
   sin cuenta ni sesión. Lo que sigue cerrado es la puerta privada: app, login,
   contrato B2B, llave o token. La distinción vigente ya no es *"tiene API
   pública"* sino **"¿un visitante cualquiera ve este número sin identificarse?"**
3. **Cadencia conservadora.** Nunca por debajo del intervalo de refresco que la
   propia fuente usa en su web. **Para una fuente raspada, además, nunca más de
   una consulta cada 15 minutos**, sea cual sea lo que declare la fuente: el
   costo de una página renderizada no lo paga solo nuestro presupuesto.
4. **User-Agent identificable y honesto en todo tráfico que salga de este
   repositorio**, con forma de contacto. Eso no se relaja y lo vigila
   `validateUserAgent()`. **Se admite que un intermediario de scraping presente
   huella de navegador**, porque es su mecanismo y no lo controlamos. La
   consecuencia hay que decirla entera: **ante la fuente raspada, el proyecto ya
   no es identificable.** Perdimos la propiedad de que alguien pudiera vernos en
   sus logs y escribirnos. Es el costo real del inciso 6.
5. **Backoff exponencial ante error.** Una fuente que responde 429 o 5xx se deja
   descansar; no se reintenta en bucle.
6. **Un bloqueo puede atravesarse por intermediario, y queda registrado como lo
   que es.** La regla anterior decía *"nunca rotar IPs, suplantar clientes ni
   buscar rodeos técnicos; una fuente que no nos quiere no entra al producto"*, y
   se deroga a sabiendas. Lo vigente:
   - Un control activo —desafío de Cloudflare, CAPTCHA, fingerprinting— **puede
     atravesarse** mediante un intermediario de scraping.
   - **Un bloqueo dirigido a nosotros, no.** Si una fuente nos identifica y nos
     bloquea de forma nominal —nos escribe, nos nombra en `robots.txt` por
     nuestro agente, o nos cursa un reclamo—, la fuente se retira del alcance en
     la corrida siguiente. Atravesar un control genérico y desoír una negativa
     dirigida no son lo mismo, y esta es la línea que queda.
   - **`robots.txt` deja de ser vinculante y pasa a registrarse.** Toda fuente
     raspada anota en el catálogo qué decía `robots.txt` sobre la ruta que
     leemos, con fecha. Que no nos detenga no es razón para no saberlo.
   - **Lo que este documento no puede enmendar son los términos de la fuente.**
     Un constitution registra nuestra decisión; no altera el contrato de un
     tercero ni la exposición legal de operar contra él. Esa valoración es del
     dueño del proyecto y se toma fuera de acá.

7. **Condiciones que admiten el scraping.** Las cinco, juntas. Si falta una, la
   fuente no entra:
   1. **No existe endpoint JSON público que dé el mismo número.** Hay que
      haberlo buscado y dejado constancia de dónde: host de API, documentación
      de desarrollador, y si un agregador ya publicado la cubre.
   2. **La tasa es visible en web abierta**, sin cuenta, sin sesión y sin pago.
   3. **El número que se raspa es un precio publicado al público**, no un
      resultado personalizado por usuario, ubicación o promoción.
   4. **La fuente aporta algo que el catálogo no tiene.** Un noveno proveedor que
      replique un precio ya cubierto no paga su fragilidad.
   5. **El valor raspado es verificable contra las referencias** (Art. III.5), o
      sea cae dentro de la banda del inciso 9. Un número que no se puede
      contrastar con nada no entra por esta vía.

8. **Obligaciones de una fuente raspada.** Su fiabilidad no es la de un JSON y el
   sistema no puede fingir que sí:
   1. **Se marca en el modelo de datos.** El catálogo lleva el método de
      adquisición por proveedor, y toda fila hereda esa marca. No es un `notes`
      en prosa: es una columna sobre la que se puede filtrar, agrupar y alertar.
      *(Implica un cambio del contrato de datos — `plan.md` §3 — y una migración
      DDL. Va por la vía del humano, como toda DDL.)*
   2. **Se marca en la interfaz, en la fila**, no en un pie de página ni en un
      "acerca de". Quien compara dos precios tiene que ver, sin buscarlo, que uno
      se leyó de una página y el otro de un campo con nombre. Art. IV manda: si
      la certeza es distinta, decirlo es parte del dato.
   3. **`raw` guarda el payload del intermediario**, no el HTML. Y hay que decir
      qué se pierde: **no hay respuesta de la fuente que podamos sostener ante
      ella.** El Art. I.2 se cumple en la letra y no en el espíritu, porque la
      procedencia llega de un tercero. Queda escrito para que nadie lo descubra
      el día que haga falta.
   4. **Fixture real igual que cualquier adapter** (Art. VII.3), capturado de la
      respuesta del intermediario, con la fecha de captura.
   5. **No participa de una afirmación que dependa de precisión.** Puede entrar
      al ranking; no puede ser la única evidencia de un hallazgo que se publique
      como medido.

9. **Qué pasa cuando se rompe.** Una fuente raspada se rompe de dos maneras, y
   la segunda es la peligrosa:

   | Cómo se rompe | Qué se ve | Quién lo nota |
   |---|---|---|
   | **Deja de dar filas** | silencio | `check:silence`, diario |
   | **Da el número equivocado** | nada | **nadie, salvo que se construya** |

   El segundo es el modo propio de esta vía: un selector que apunta a otro
   elemento devuelve un número plausible, no un error. Por eso:

   1. **Banda de verosimilitud, obligatoria y previa a persistir.** Toda fila
      raspada se contrasta contra las referencias de la corrida. Fuera de banda
      **no se guarda**: es fallo de fuente (Art. I.2), no observación. Una fila
      inventada es peor que una fila ausente, y esta es la única defensa contra
      un DOM que cambió.
   2. **Inmovilidad.** El precio raspado entra en la vigilancia de precio
      inmóvil del Art. VI.2 igual que los demás.
   3. **Retiro por plazo, y el reloj lo corre el chequeo diario:**

      | Situación | Plazo | Qué pasa |
      |---|---|---|
      | Silencio o fuera de banda | **48 h** | incidente declarado |
      | Sin arreglar | **7 días** desde el incidente | **se retira del ranking**, sin discusión |
      | Dos episodios en **30 días** | — | se retira aunque el segundo se haya arreglado |

      El retiro es quitarla del ranking y de la interfaz. **Las filas ya
      capturadas no se borran**: `quotes` es inmutable (Art. I).
   4. **Estos tres números son elegidos, no medidos.** No hay una sola fuente
      raspada en producción al escribirlos. Se remiden cuando haya 30 días de
      datos, y hasta entonces se citan como provisionales. Es la lección del
      umbral copiado (T029) aplicada por adelantado: un umbral sin medir se
      declara como tal.

## Artículo VI — Observabilidad antes que funcionalidad

El modo de falla real de este proyecto no es el crash: es el adapter que
silenciosamente devuelve datos viejos durante semanas.

1. **Toda corrida deja registro**: qué fuentes se intentaron, cuáles
   respondieron, cuáles fallaron y por qué.
2. **El silencio tiene tres formas y las tres son error.** El sistema las
   reporta de forma activa, y son distintas porque llevan a acciones distintas.

   **a. Una fuente deja de responder.** No hay filas suyas. Funciona porque un
   fallo de consulta no deja rastro en `quotes` (Art. I.2): la ausencia
   significa ausencia.

   **b. Una fuente responde siempre lo mismo.** Es la que nombra el preámbulo y
   la que nadie nota, porque las filas siguen llegando frescas. Se mide sobre
   la misma vía —proveedor, dirección, monto y método de pago— porque un precio
   que cambia con el monto no es un precio que cambia con el tiempo.

   **c. La ingesta deja de correr.** Un sistema detenido no tiene fuentes mudas
   —no hay corridas en las que estarlo— así que la redacción anterior de este
   artículo, medida en corridas, **se cumplía de forma vacía justo cuando todo
   estaba roto**. Se vigila la cadencia contra el horario, no contra el dato.

   **Cuando la causa no es distinguible desde el dato, se escala por duración y
   no se afirma la causa.** Un precio quieto puede ser un mercado quieto o un
   adapter congelado, y desde la base se ven idénticos; una referencia vieja
   puede ser la fuente o nosotros. Pasado el tiempo suficiente deja de importar
   cuál: alguien tiene que mirar. Afirmar la causa sería inventar un dato sobre
   nosotros mismos, que es el Artículo I aplicado hacia adentro.

   **Todo umbral se mide antes de elegirse.** El primero que se puso para un
   precio inmóvil iba a copiar el de las referencias, 12 h; medido, la racha
   legítima más larga era de 10,8 h. Habría dado falsa alarma en días, y una
   alarma que grita sobre datos sanos se apaga.
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

Toda enmienda se documenta acá con fecha y motivo. **Los artículos I y II no se
relajan por conveniencia de implementación ni por presión de alcance.**

**El Artículo V estaba en esa lista hasta la v2.0.0 y ya no está.** Se relajó el
2026-09-17 para admitir una fuente concreta. La cláusula no se reinterpretó ni se
descubrió que decía otra cosa: decía exactamente lo que parecía y se derogó. Se
deja escrito así porque la alternativa —enmendar el artículo y dejar la cláusula
diciendo que es inviolable— habría dejado el documento contradiciéndose a sí
mismo, que es el defecto que este proyecto persigue en el código.

**Lo que esa cláusula seguía protegiendo, y por qué I y II sí se quedan:** I y II
son sobre lo que le decimos a quien nos lee. V era sobre cómo tratamos a terceros.
Relajar V tiene un costo externo y uno de fragilidad; relajar I o II sería mentir.

**Versión 2.0.0** — *major*, del 2026-09-17: cuatro enmiendas al Artículo V, dos
incisos nuevos, y la derogación parcial de esta misma cláusula. Deriva de la
decisión de integrar **Global66** mediante un intermediario de scraping
(Browse AI), tomada por el dueño del proyecto con la evidencia a la vista.

**La evidencia que había, medida el 2026-09-17** y citada acá para que la decisión
quede sostenida por lo que se sabía y no por lo que se recuerde:

| Qué | Resultado |
|---|---|
| `www.global66.com/co/` con nuestro UA honesto | `403`, `Cf-Mitigated: challenge` |
| `www.global66.com/quoter/` | `403`, mismo desafío |
| `robots.txt`, grupo `User-agent: *` | `Disallow: /quoter/` — la ruta del cotizador |
| `robots.txt`, por nombre | `ClaudeBot`, `GPTBot` y otros bots de IA: `Disallow: /` |
| `api.global66.com` | `403 ForbiddenException` (AWS API Gateway) |
| Documentación B2B | API Key y relación comercial; sin endpoint de tasas |
| Comparación de Wise `US → CO` | devuelve `wise`, `instarem`, `western-union`; **no** Global66 |

**Las cuatro enmiendas:**

- **V.1** — el scraping de HTML renderizado deja de estar prohibido y pasa a
  estar condicionado (incisos 7 a 9). Donde exista JSON público, sigue siendo
  obligatorio usarlo.
- **V.2** — una fuente sin API pública puede entrar si su tasa es visible en web
  abierta. Sigue cerrada la puerta privada: app, login, contrato o llave.
- **V.4** — se admite que el intermediario presente huella de navegador. **El
  tráfico propio de este repositorio sigue obligado a identificarse**, y lo
  vigila `validateUserAgent()`.
- **V.6** — un control activo puede atravesarse por intermediario. **Un bloqueo
  dirigido a nosotros, no**: ése retira la fuente en la corrida siguiente.

**Dos incisos nuevos, que son el precio de las cuatro de arriba:** V.7 fija las
cinco condiciones que admiten el scraping, V.8 las obligaciones de marcado —en
el modelo de datos **y** en la interfaz— y V.9 la banda de verosimilitud y los
plazos de retiro.

**Qué se cedió, sin adornar.** Tres cosas, y la tercera no se recupera con
ingeniería:

1. **La procedencia.** `raw` guardará el payload de un tercero, no la respuesta
   de la fuente. El Art. I.2 se cumple en la letra, no en el espíritu.
2. **La robustez.** Un `<div>` que cambia no da error: da otro número. Por eso
   V.9.1 exige la banda de verosimilitud *antes* de persistir. Sin esa defensa
   esta enmienda sería incompatible con el Art. I.
3. **La identificabilidad ante la fuente raspada.** Global66 ya no puede vernos
   en sus logs ni escribirnos. Hasta hoy, cualquier fuente del proyecto podía.

**Qué revertiría esta enmienda.** Cualquiera de las tres, y las dos primeras son
automáticas:

- **Global66 nos bloquea de forma dirigida** —nos escribe, nos nombra, nos cursa
  un reclamo—. V.6 ya lo dice: retiro en la corrida siguiente.
- **Global66 publica un endpoint JSON público, o nos da acceso autorizado.**
  Entonces V.1 obliga a usarlo y la vía raspada se retira por ser peor.
- **La banda de verosimilitud no alcanza para atrapar un DOM cambiado.** Si una
  fila equivocada llega a producción y la banda la dejó pasar, la premisa de
  esta enmienda —que la fragilidad se puede vigilar— era falsa, y lo que
  corresponde es revertir el artículo, no ensanchar la banda.

**Lo que esta enmienda explícitamente NO resuelve:** los términos de servicio de
Global66 y la exposición legal de operar contra ellos. Este documento registra
una decisión interna; no altera el contrato de un tercero. Quedó dicho antes de
tomar la decisión y queda escrito después.

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

**Versión 1.6.0** — una enmienda al Artículo IV.3, del 2026-09-15, derivada de
T029. La cláusula afirmaba que la TRM se calcula "sobre operaciones
interbancarias del día hábil anterior". Verificado contra los metadatos de la
propia fuente: dice **promedio ponderado de operaciones de compra y venta de
contado**, y **no dice nada** del día hábil anterior. Las dos precisiones eran
de memoria, escritas el 2026-09-12, antes del primer adapter.

El artículo ahora **cita la definición de la fuente** en vez de parafrasearla, y
dice menos donde no se pudo verificar. Es la regla de "una cita no es una
verificación" aplicada al propio documento que la exige.

**Versión 1.5.0** — una enmienda al Artículo VI.2, del 2026-09-15, derivada de
T029 y de dos fallos reales. El artículo decía "si una fuente lleva más de N
corridas sin datos", y eso describía un sistema más chico del que existe:

- medido **en corridas**, se satisfacía de forma vacía cuando no había corridas
  — que es precisamente el estado en que el cron estuvo caído dos días;
- cubría la **ausencia** de datos y no la **inmovilidad**, que es la falla que
  el propio preámbulo del artículo nombra como la real, y que hasta T029 no
  estaba detectada para ninguno de los ocho proveedores;
- y no decía nada sobre qué hacer cuando la causa no se puede distinguir desde
  el dato, que resultó ser el caso normal y no la excepción.

La enmienda describe las tres formas de silencio que el sistema ya vigila, y
agrega dos reglas que salieron de equivocarse: escalar por duración en vez de
afirmar la causa, y medir un umbral antes de elegirlo.

**Versión 1.4.0** — una enmienda editorial al Artículo III.2, sin efecto
funcional: "rail" pasa a `asset` + `channel`. El esquema hizo ese cambio en
`plan.md` §2 porque una sola columna no podía expresar que Binance P2P es p2p
sobre USDT, y el término viejo sobrevivía acá y en tres requisitos de `spec.md`.
Se alinea antes de T029, que recorre este documento artículo por artículo.
