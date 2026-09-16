/**
 * The password gate (T022, HU-07).
 *
 * All of the logic lives here, as pure functions, so it can be tested with
 * `node --test` instead of by driving a browser. The middleware is a thin
 * shell around `gateDecision`.
 *
 * ## HU-07 asks for two things that pull against each other
 *
 * "Removing the protection is a configuration change, not a code change" — so
 * some value of the environment has to mean *open*. But an environment
 * variable that is simply **missing** must not mean open, because the most
 * likely accident during the private period is deploying without setting it,
 * and that accident would publish the site silently.
 *
 * So the switch is explicit in both directions:
 *
 * | `SITE_PASSWORD` | Result |
 * |---|---|
 * | a password | gated |
 * | the literal `off` | open — this is the config change HU-07 asks for |
 * | unset or blank | **503, refusing to serve** |
 *
 * Failing closed on a missing variable costs an outage nobody but the owner
 * sees. Failing open costs the thing the private period exists to prevent.
 *
 * ## The cookie is derived, not asserted
 *
 * A cookie holding `authenticated=1` is not a lock: anyone can set it. This
 * one holds an HMAC keyed by the password itself, so producing it requires
 * knowing the password, and no second secret has to be managed. Comparison is
 * constant-time — a gate that leaks its answer through timing is a gate with a
 * window next to it.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

export const COOKIE_NAME = 'dolarito_acceso';

/** Thirty days. Long enough not to be a nuisance, short enough to expire. */
export const COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

/** The value of `SITE_PASSWORD` that means "the private period is over". */
export const OPEN_SENTINEL = 'off';

/**
 * Paths that answer before the gate does.
 *
 * `/entrar` is the form itself: gating it is an infinite redirect. The rest is
 * what the form needs to render — styles and the logo. They carry no data:
 * every quote is fetched server-side (N4, plan.md §2.3), so there is nothing
 * behind these paths worth locking.
 *
 * **The logo files are listed one by one, not as a `/logo-` prefix.** A prefix
 * would open every future file whose name happens to start that way, and the
 * point of this list is that adding to it is a decision somebody made on
 * purpose. Three lines is a cheap price for that.
 */
export const PUBLIC_PREFIXES = [
  '/entrar',
  '/_astro/',
  '/logo-32.png',
  '/logo-64.png',
  '/logo-180.png',
] as const;

export type GateConfig =
  | { kind: 'gated'; password: string }
  | { kind: 'open' }
  | { kind: 'misconfigured' };

/** Reads the switch. `raw` is `SITE_PASSWORD` straight from the environment. */
export function readGateConfig(raw: string | undefined): GateConfig {
  const value = (raw ?? '').trim();
  if (value === '') return { kind: 'misconfigured' };
  if (value === OPEN_SENTINEL) return { kind: 'open' };
  return { kind: 'gated', password: value };
}

/**
 * The cookie value for a given password.
 *
 * Keyed by the password, so whoever knows the password can compute it and
 * nobody else can. The version tag means a future change to the scheme
 * invalidates old cookies instead of silently accepting them.
 */
export function sessionToken(password: string): string {
  return createHmac('sha256', password).update('dolarito-session-v1').digest('hex');
}

/** Constant-time equality. Both sides are fixed-length hex, so length leaks nothing. */
export function sameToken(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/** Does this submitted password open the gate? Compared through the derived token. */
export function passwordMatches(submitted: string, configured: string): boolean {
  return sameToken(sessionToken(submitted), sessionToken(configured));
}

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(prefix));
}

export type GateDecision =
  | { kind: 'allow' }
  | { kind: 'redirect'; to: string }
  | { kind: 'misconfigured' };

/**
 * The whole gate, as one decision.
 *
 * Order matters and is deliberate: a misconfigured deployment refuses
 * **everything**, including the login form. A blank `SITE_PASSWORD` is not a
 * state anyone chose, so serving anything at all under it would be guessing.
 */
export function gateDecision(input: {
  pathname: string;
  cookie: string | undefined;
  config: GateConfig;
}): GateDecision {
  const { pathname, cookie, config } = input;

  if (config.kind === 'misconfigured') return { kind: 'misconfigured' };
  if (config.kind === 'open') return { kind: 'allow' };
  if (isPublicPath(pathname)) return { kind: 'allow' };

  if (cookie !== undefined && sameToken(cookie, sessionToken(config.password))) {
    return { kind: 'allow' };
  }

  // Where the visitor was going, so the form can send them back there. Only a
  // same-site path is ever carried: an absolute URL here would turn the login
  // form into an open redirect.
  const target = pathname.startsWith('/') && !pathname.startsWith('//') ? pathname : '/';
  return { kind: 'redirect', to: `/entrar?volver=${encodeURIComponent(target)}` };
}

/**
 * Sanitises the `volver` parameter before redirecting to it.
 *
 * Anything that is not a plain same-site path becomes `/`. Without this, a
 * link like `/entrar?volver=https://evil.example` would bounce a logged-in
 * owner straight off the site with the site's own domain in the referrer.
 */
export function safeReturnPath(raw: string | null): string {
  if (raw === null || raw === '') return '/';
  if (!raw.startsWith('/') || raw.startsWith('//')) return '/';
  return raw;
}

export type CookieOptions = {
  httpOnly: true;
  secure: boolean;
  sameSite: 'lax';
  path: '/';
  maxAge: number;
};

/** `secure` comes from the caller because dev runs over plain http. */
export function cookieOptions(secure: boolean): CookieOptions {
  return {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
    maxAge: COOKIE_MAX_AGE_SECONDS,
  };
}
