# Spec — Dolarito

**Rama sugerida:** `001-dolarito`
**Ubicación esperada en el repo:** `specs/001-dolarito/spec.md`
**Estado:** preguntas abiertas resueltas — listo para `plan.md`
**Fecha:** 2026-09-12

> Este documento describe **qué** hace el producto y **por qué**. No contiene
> decisiones de tecnología, framework, esquema de base de datos ni nombres de
> endpoints. Todo eso vive en `plan.md`.

---

## 1. Problema

Una persona en Colombia que quiere comprar o vender dólares tiene hoy una docena
de opciones —fintechs, exchanges, remesadoras— y ninguna forma razonable de
saber cuál le conviene.

Tres razones concretas:

- **La tasa anunciada no es el precio.** Un proveedor con mejor tasa y comisión
  alta entrega menos pesos que uno con peor tasa y sin comisión. Comparar tasas
  de frente lleva sistemáticamente a la decisión equivocada.
- **El precio depende del monto.** Las mismas dos apps cambian de posición según
  si son 100 o 1.000 dólares.
- **La TRM no ayuda.** Es la referencia que todo el mundo cita, pero ningún
  proveedor retail la ofrece. Compararse contra ella solo genera desconfianza,
  sin informar la decisión.

El resultado es que la gente elige por costumbre, por recomendación de un video,
o por cuál app ya tenía instalada.

## 2. A quién sirve

**Usuario primario:** persona en Colombia que compra o vende dólares por cuenta
propia. Freelancer que recibe pagos del exterior, alguien que ahorra en dólares,
alguien que va a viajar.

**Usuario secundario:** persona que recibe una remesa desde el exterior, o quien
la envía.

Ambos escenarios están **dentro del alcance de la v1**, pero son productos
distintos y se presentan por separado (ver §3, MODO).

**Fuera del alcance:** empresas, operaciones de tesorería, traders de alta
frecuencia.

## 3. Concepto estructural: MODO

El producto opera en dos modos excluyentes. El usuario elige uno; nunca se
mezclan en una misma tabla.

| Modo | Situación | Proveedores |
|---|---|---|
| **Local** | La persona está en Colombia y convierte entre COP y dólares digitales | Eldorado, DolarApp, Binance P2P, Bitso, Buda |
| **Remesa** | El dinero sale del exterior en USD y llega a Colombia en COP | Wise, Instarem, Western Union |

La distinción no es cosmética: un usuario en modo Remesa no puede usar Binance
P2P desde el exterior, y uno en modo Local no tiene cómo originar una
transferencia desde Estados Unidos. Presentarlos juntos produciría un ranking
con ganadores inalcanzables.

La TRM y la tasa media de mercado se muestran en **ambos** modos, siempre como
contexto.

## 4. Historias de usuario

### HU-01 — Ver el mejor precio para comprar dólares (modo Local)
**Como** alguien que quiere convertir pesos a dólares,
**quiero** ver **quién me cobra menos pesos por los dólares que quiero**,
**para** no perder dinero por elegir mal.

> Redactada así a propósito, y no como "quién me entrega más dólares por mi
> monto". Toda comparación fija el lado en dólares y deja variar el otro
> (Art. III.1): "quiero 100 dólares" es una pregunta que todos los proveedores
> responden igual, mientras "tengo 400.000 pesos" depende de una tasa de
> conversión no especificada y distinta en cada corrida. Comprando, lo que varía
> es lo que pago.

Criterios de aceptación:
- Dado un monto **en dólares**, veo una lista ordenada de proveedores.
- El orden es **por el lado variable de la operación** —acá, los pesos que
  pago, de menor a mayor— y nunca por la tasa anunciada (Art. III.1).
- Cada entrada muestra: proveedor, tasa, comisión, monto final, y cuándo se
  capturó el dato.
- La diferencia contra la mejor opción se expresa en pesos, no solo en
  porcentaje.

### HU-02 — Ver el mejor precio para vender dólares (modo Local)
Igual que HU-01, en el sentido inverso. Compra y venta son vistas separadas y
nunca se mezclan en una sola tabla.

### HU-03 — Ver el mejor precio para enviar una remesa (modo Remesa)
**Como** alguien que manda dinero a Colombia desde el exterior,
**quiero** ver qué servicio entrega más pesos por los dólares que envío,
**para** que llegue más dinero.

Criterios de aceptación:
- El ranking ordena por pesos recibidos, incluyendo comisión.
- Cada entrada muestra el tiempo estimado de entrega, porque en remesas la
  velocidad compite con el precio.
- Se indica que estos precios son estimaciones recolectadas periódicamente, no
  cotizaciones en vivo.

### HU-04 — Comparar a mi monto real
**Como** alguien que maneja montos concretos,
**quiero** que la comparación refleje mi monto,
**para** que el ranking sea verdad para mi caso y no para un caso promedio.

Criterios de aceptación:
- Brackets disponibles: **1, 100, 500 y 1.000 USD**.
- Al cambiar el monto, el ranking se reordena si corresponde.
- Si un proveedor no opera a ese monto por mínimo o máximo, aparece **marcado
  como no disponible con el motivo**, nunca oculto.
- El bracket de 1 USD es deliberado: su función es revelar el impacto de las
  comisiones fijas y los montos mínimos. Se espera que la mayoría de
  proveedores aparezcan como no disponibles ahí, y esa es precisamente la
  información que aporta.

**Ampliación del 2026-09-26 — monto libre donde el dato lo sostiene.**

Los cuatro brackets eran el medio, no el fin: lo que esta historia pide es que
la comparación *refleje mi monto*. Para una parte de los proveedores se puede
responder a cualquier monto **sin inventar nada**, y para el resto no.

- **Un proveedor admite monto libre si, y solo si, su `gross_rate` es el mismo
  en los cuatro brackets y no reporta comisión.** Las dos condiciones se leen
  del dato en cada corrida, **nunca de una lista de proveedores escrita a
  mano**: si uno empieza a cobrar comisión o su tasa pasa a depender del monto,
  cae solo a modo bracket, que es la dirección segura del fallo.
- Medido el 2026-09-26: lo cumplen **bitso, buda y dolarapp** — un ticker es un
  precio para todos. No lo cumplen `binance_p2p` (su ponderado depende de la
  profundidad del libro), `eldorado` (comisión porcentual) ni `wise`,
  `instarem` y `western_union` (comisión fija que **escala**: Wise cobra 3,29
  USD a 100, 9,40 a 500 y 17,03 a 1000).
- Para quien admite monto libre, la conversión es `monto × gross_rate`.
  Verificado contra las filas guardadas: reproduce cada importe con un desvío
  máximo de **0,44 COP**, que es el redondeo al peso que ya aplica `money.ts`.
- **Quien no lo admite no desaparece ni se interpola.** Muestra el bracket
  medido más cercano y **dice que ése es el monto medido, no el pedido**. Un
  número interpolado sería una observación que nadie hizo (Art. I.1), y el
  Art. III.3 existe justamente porque el precio depende del monto.

Criterio de aceptación adicional: escribir un monto que no sea un bracket
**nunca** produce una cifra sin decir de qué monto es.

### HU-05 — Entender la TRM sin que me confunda
**Como** alguien que ve la TRM en las noticias,
**quiero** entender por qué ninguna app me la ofrece,
**para** no concluir que todos me están estafando.

Criterios de aceptación:
- La TRM se muestra de forma destacada, en jerarquía distinta al ranking.
- Va acompañada de una explicación breve de qué es y de qué día corresponde.
- Nunca aparece como una fila más del ranking.
- Los fines de semana y festivos se indica explícitamente que está congelada
  mientras el resto del mercado sigue moviéndose.

### HU-06 — Saber si el dato está fresco
**Como** alguien a punto de mover dinero real,
**quiero** saber de cuándo es cada precio,
**para** decidir si confío en él.

Criterios de aceptación:
- Cada precio muestra su momento de captura.
- Un dato con más de una hora se marca visiblemente como desactualizado.
- Si una fuente lleva tiempo sin responder, se indica en vez de mostrar su
  último valor como si fuera actual.

### HU-07 — Entrar al sitio durante el periodo privado
**Como** dueño del proyecto,
**quiero** que el sitio esté publicado pero cerrado con contraseña,
**para** validarlo en producción real sin exponerlo antes de tener histórico.

Criterios de aceptación:
- El sitio está desplegado en su dominio desde el día uno.
- Todo el contenido queda detrás de una contraseña compartida única.
- Quitar la protección es un cambio de configuración, no un cambio de código.
- La ingesta corre igual, independientemente de la protección.

### HU-08 — Ver cómo se ha comportado un proveedor *(posterior a la v1)*
**Como** alguien que va a operar de forma recurrente,
**quiero** ver el margen histórico de cada proveedor contra el mercado,
**para** saber si su precio es consistente o solo es bueno hoy.

Criterios de aceptación:
- Por proveedor: evolución de su margen implícito contra la tasa media de
  mercado.
- Se puede ver si el margen se ensancha en fines de semana o en días volátiles.

> Esta historia **no se construye en la v1, pero la v1 debe hacerla posible**:
> requiere capturar la tasa media de mercado en el mismo instante que cada
> precio, desde el primer día. Sin eso, esta función no puede existir nunca.

## 5. Requisitos funcionales

**Ingesta**
- RF-01 — El sistema captura precios de un conjunto fijo de proveedores cada
  **15 minutos**, de forma automática.
- RF-02 — Cada captura registra ambos lados (compra y venta) cuando la fuente los
  expone.
- RF-03 — Cada captura registra el bracket de monto al que aplica el precio.
- RF-04 — Cada captura registra, en el mismo momento, la tasa media de mercado y
  la TRM vigente.
- RF-05 — Cada fila declara su modo (Local o Remesa), su `asset` y su `channel`.
- RF-06 — La falla de una fuente no impide registrar las demás.
- RF-07 — Cada corrida deja constancia de qué fuentes respondieron y cuáles no.

**Presentación**
- RF-08 — El sitio muestra la TRM vigente como contexto, con explicación, en
  ambos modos.
- RF-09 — El sitio muestra rankings separados por modo y por dirección.
- RF-10 — Cada fila declara su `asset`, su `channel` y su momento de captura.
- RF-11 — Los datos desactualizados se marcan, nunca se ocultan ni se maquillan.
- **RF-11b — Un precio que no es firme se declara como tal.** Si un proveedor
  entrega una cotización con tolerancia de variación o vencimiento corto, la
  interfaz lo dice en la fila. No basta con guardarlo: mostrarlo como una fila
  más induce a error.

  El caso concreto es **Eldorado**, y es el único de los ocho: sus cotizaciones
  traen **tolerancia de deslizamiento del 2%** y **vencen a los 2 minutos**. Los
  demás proveedores publican un precio de libro que vale para cualquiera en ese
  momento.

  Por qué es un requisito y no un detalle: **el 2% de tolerancia supera la
  distancia que separa a varios proveedores del ranking.** Un usuario que ve a
  Eldorado primero por un margen del 0,5% está mirando una comparación que la
  tolerancia puede invertir sola, sin que nada haya fallado y sin que nadie haya
  mentido. Presentarlo como equivalente a un precio firme convierte un ranking
  correcto en una conclusión falsa — que es exactamente lo que el Artículo IV
  existe para impedir.

  Lo mismo vale para el vencimiento: con captura cada 15 minutos, una fila de
  Eldorado está vencida 13 de cada 15. Sigue siendo una observación real de lo
  que valía en su momento, y por eso se guarda; lo que no puede es presentarse
  como un precio tomable ahora.

  Esto no es recomendar ni desaconsejar a nadie (§7): es declarar una diferencia
  de naturaleza entre dos cosas que la tabla pone una al lado de la otra.
- **RF-11c — Cuando un bracket mayor consigue mejor precio que uno menor, la
  interfaz lo explica.** Sin explicación se lee como un error del sitio, no como
  una propiedad del mercado.

  Ocurre de verdad y no es raro. Medido en `binance_p2p` el 2026-09-13: comprar
  500 USD sale a 3.079,73 COP por dólar y comprar 100 sale a 3.082,59 — **el
  monto mayor consigue mejor precio.** La causa no es el volumen: en P2P cada
  anuncio fija su propio mínimo, y los mejores suelen pedir montos altos. Un
  monto chico no paga más por ser chico, **paga más por quedar excluido de los
  mejores anuncios**. Comprando 100 solo califican 7 de 20 anuncios; comprando
  500, 18 de 20.

  Es exactamente lo que HU-04 existe para revelar —el efecto del monto sobre el
  precio real— pero contradice la intuición de que los montos grandes son los que
  negocian mejor, y sin decirlo el usuario concluye que la tabla está mal.

  Esto no es recomendar operar por un monto ni por otro (§7): es explicar por qué
  dos filas del mismo proveedor se ordenan al revés de lo esperado.

- RF-12 — El sitio funciona en móvil como caso principal.
- RF-13 — Todo el sitio queda tras contraseña hasta que se decida abrirlo.

**Contenido**
- RF-14 — Existe una explicación accesible de qué es la TRM y por qué difiere de
  lo que ofrecen las apps.
- RF-15 — Cada proveedor tiene una ficha con qué es, qué `asset` y `channel` usa, en qué modo
  opera y qué métodos de pago acepta cuando aplica.

## 6. Fuentes incluidas (alcance congelado)

| Fuente | Modo | Aporta |
|---|---|---|
| Eldorado | Local | Precio por método de pago, con comisión desglosada |
| DolarApp / ARQ | Local | Compra y venta sobre stablecoin |
| Binance P2P | Local | Libro de ofertas, ambos lados |
| Bitso | Local | Compra y venta de mercado |
| Buda.com | Local | Compra y venta de mercado |
| Wise (comparación) | Remesa | Aporta además Instarem y Western Union |
| TRM oficial | Ambos | Referencia, no ofertante |
| Tasa media de mercado | Ambos | Referencia, base del cálculo de margen |

## 7. Explícitamente fuera de alcance

- Proveedores cuya tasa solo existe dentro de una app autenticada: Littio,
  Global66, Lemon Cash, Meru, Plenti, Wallbit, Airtm, LuloX.
- Cualquier técnica de interceptación de tráfico móvil o scraping de HTML.
- Ejecución de operaciones, alertas de precio, cuentas de usuario individuales.
- Recomendaciones de inversión o de momento de compra.
- Pares de divisas distintos a USD/COP.

**Nota sobre stablecoins:** el modo Local opera en la práctica íntegramente sobre
stablecoins (USDT, USDC), no sobre dólares bancarios. Esto **sí** está dentro del
alcance —es cómo funciona ese mercado en Colombia— pero la interfaz debe
declararlo de forma explícita en cada fila y en la ficha de cada proveedor. Un
usuario que crea estar comparando dólares bancarios cuando compara USDT está
tomando una decisión mal informada.

## 8. Métricas de éxito

- **Cobertura:** al menos 6 de los 8 **proveedores** con dato fresco en cualquier
  momento. Las referencias (TRM, mid-market) no son proveedores y se miden
  aparte: su ausencia es un incidente, no una degradación.
- **Continuidad:** 30 días corridos de ingesta sin huecos mayores a 2 horas.
- **Utilidad:** el ranking cambia de líder al variar el bracket de monto — si el
  primer lugar es siempre el mismo sin importar el monto, el producto no está
  aportando nada que no se pueda saber mirando una sola app.
- **Honestidad:** cero incidentes de dato mostrado como actual estando vencido.

## 9. Decisiones tomadas

| # | Decisión |
|---|---|
| 1 | Nombre del producto: **Dolarito** |
| 2 | La v1 incluye ambos modos: Local y Remesa, presentados por separado |
| 3 | Brackets: 1, 100, 500 y 1.000 USD |
| 4 | Cadencia de captura: 15 minutos |
| 5 | Publicado desde el día uno, protegido con contraseña |

## 10. Pendientes

- `[NECESITA DECISIÓN]` Dominio. No bloquea el `plan.md`; sí bloquea el
  despliegue. Conviene resolverlo antes de la primera tarea de deploy.
