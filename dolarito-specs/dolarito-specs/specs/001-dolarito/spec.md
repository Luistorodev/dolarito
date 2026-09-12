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
**quiero** ver qué proveedor me entrega más dólares por mi monto,
**para** no perder dinero por elegir mal.

Criterios de aceptación:
- Dado un monto, veo una lista ordenada de proveedores.
- El orden es por lo que efectivamente recibo, no por la tasa anunciada.
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
- RF-05 — Cada fila declara su modo (Local o Remesa) y su rail.
- RF-06 — La falla de una fuente no impide registrar las demás.
- RF-07 — Cada corrida deja constancia de qué fuentes respondieron y cuáles no.

**Presentación**
- RF-08 — El sitio muestra la TRM vigente como contexto, con explicación, en
  ambos modos.
- RF-09 — El sitio muestra rankings separados por modo y por dirección.
- RF-10 — Cada fila declara su rail y su momento de captura.
- RF-11 — Los datos desactualizados se marcan, nunca se ocultan ni se maquillan.
- RF-12 — El sitio funciona en móvil como caso principal.
- RF-13 — Todo el sitio queda tras contraseña hasta que se decida abrirlo.

**Contenido**
- RF-14 — Existe una explicación accesible de qué es la TRM y por qué difiere de
  lo que ofrecen las apps.
- RF-15 — Cada proveedor tiene una ficha con qué es, qué rail usa, en qué modo
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
