/**
 * The gate itself (T022, HU-07).
 *
 * Thin on purpose: every rule lives in `lib/auth.ts`, where it is tested
 * without a browser. This file only translates a decision into a response.
 */

import { defineMiddleware } from 'astro/middleware';
import { COOKIE_NAME, gateDecision, readGateConfig } from './lib/auth.ts';

export const onRequest = defineMiddleware(async (context, next) => {
  const decision = gateDecision({
    pathname: context.url.pathname,
    cookie: context.cookies.get(COOKIE_NAME)?.value,
    config: readGateConfig(import.meta.env['SITE_PASSWORD']),
  });

  if (decision.kind === 'allow') return next();

  if (decision.kind === 'redirect') return context.redirect(decision.to, 302);

  // Misconfigured: SITE_PASSWORD is unset or blank. Refuse everything rather
  // than guess which side of the private period we are on. 503 and not 500
  // because the deployment is wrong, not the code, and it is fixed by setting
  // a variable rather than by shipping anything.
  return new Response(
    'Dolarito no está configurado: falta SITE_PASSWORD.\n\n' +
      'Poné una contraseña para cerrar el sitio, o el literal "off" para abrirlo.\n' +
      'Mientras la variable esté vacía no se sirve nada, a propósito.\n',
    {
      status: 503,
      headers: {
        'content-type': 'text/plain; charset=utf-8',
        'cache-control': 'no-store',
      },
    },
  );
});
