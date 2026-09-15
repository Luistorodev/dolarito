---
layout: ../layouts/Texto.astro
title: Qué es la TRM
description: Qué es la Tasa Representativa del Mercado y por qué ninguna app te la ofrece.
---

# Qué es la TRM

La TRM es la tasa oficial del dólar en Colombia. La leemos del portal de datos
abiertos del Estado, `datos.gov.co`, del conjunto `32sa-8pi3`, que es de donde
sale el número que ves en la página principal.

La fuente la define así:

> La Tasa de Cambio Representativa del Mercado–TRM corresponde al promedio
> ponderado de las operaciones de compra y venta de contado de dólares de los
> Estados Unidos de América a cambio de moneda legal colombiana.

La publica la **Superintendencia Financiera de Colombia**, con frecuencia
diaria. Eso es lo que dice la fuente y es todo lo que afirmamos: la ficha
técnica completa la publica ella.

Cada registro trae dos fechas: desde cuándo rige y hasta cuándo. Eso importa más
de lo que parece, y lo explicamos abajo.

## Por qué ninguna app te la ofrece

Porque **no es un precio: es una estadística**.

La TRM describe cómo se movió el mercado, no lo que alguien te va a cobrar. Un
proveedor tiene que comprar los dólares que te vende, pagar por moverlos, y
quedarse con algo. Ninguna de esas tres cosas está dentro de la TRM.

Entonces cuando una app dice "al precio del dólar de hoy", está diciendo una de
dos cosas: o se refiere a otra tasa, o te está comparando contra una vara que
nadie alcanza.

> Acá la TRM se usa como **vara de medir**, no como una promesa. Sirve para
> responder "¿cuánto me estoy alejando de la referencia?", que es una pregunta
> con respuesta, en vez de "¿quién me da la TRM?", que no la tiene.

## Cuánto se aleja cada uno

Cada fila de la comparación lleva un margen, y dice **"sobre el mercado"** a
propósito: **no se mide contra la TRM**.

Suena raro en una página sobre la TRM, así que vale el porqué. La TRM es un solo
número por día y **se queda quieta los fines de semana y festivos**. Un margen
calculado contra ella se movería los lunes sin que nadie hubiera cambiado un
precio: sería una señal del calendario, no del mercado. Por eso el margen se
calcula contra la tasa media de mercado en vivo, que sí se mueve cuando el
mercado se mueve.

La TRM sigue arriba, porque es la referencia que la gente conoce y busca. Las
dos tienen papeles distintos y no son intercambiables.

Dos cosas más sobre cómo se calcula:

**Se calcula desde el monto efectivo, no desde la tasa anunciada.** Si un
proveedor anuncia una tasa buena y después cobra una comisión aparte, la tasa
anunciada miente sobre lo que recibís. Medimos lo segundo.

**Positivo siempre significa peor que la referencia**, en las dos direcciones.
Vendiendo, "peor" es recibir menos pesos; comprando, es pagar más. Una sola
fórmula para ambas mostraría un recargo del 4% como si fuera un descuento.

## Por qué a veces la TRM no cambia

Porque **no se publica todos los días**. Los fines de semana y los festivos
rigen con la del último día hábil, y el propio registro lo dice: trae la fecha
hasta la que vale.

Por eso la página marca cuando la tasa cubre más de un día. No es un dato viejo
ni un error nuestro: es la misma tasa, vigente, porque así funciona.

Y por eso este proyecto **no tiene un calendario de festivos colombianos**. No
hace falta: la fuente ya dice cuánto dura su propio número. Un calendario
nuestro sería una segunda versión de la verdad, y se desactualizaría.

## Qué no dice esta página

El detalle fino del cálculo: qué operaciones entran, con qué corte horario, cómo
se pondera. La definición de arriba es literal de la fuente y hasta ahí llega lo
que verificamos; la ficha técnica completa la publica la Superintendencia.

Hubo una versión de esta página que no citaba ninguna definición, por prudencia.
Resultó ser prudencia mal puesta: la fuente **sí** publica una, y no haberla
buscado dejó al proyecto afirmando de memoria en un documento interno una
metodología que la fuente describe de otro modo.
