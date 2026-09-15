---
layout: ../layouts/Texto.astro
title: Qué es la TRM
description: Qué es la Tasa Representativa del Mercado y por qué ninguna app te la ofrece.
---

# Qué es la TRM

La TRM es la tasa oficial del dólar en Colombia. La leemos del portal de datos
abiertos del Estado, `datos.gov.co`, del conjunto `32sa-8pi3`, que es de donde
sale el número que ves en la página principal.

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

Eso es exactamente lo que mide la columna de margen en la comparación. Y hay dos
cosas que conviene saber sobre cómo la calculamos:

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

Cómo se calcula la TRM por dentro. Sabemos de dónde la leemos y qué vigencia
declara cada registro, porque eso lo verificamos contra la fuente. La
metodología exacta la publica la autoridad que la emite, y preferimos no
parafrasearla de memoria: este proyecto tiene como regla no afirmar lo que no
midió.
