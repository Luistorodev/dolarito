/**
 * Tests for the password gate (T022).
 *
 * The done criterion is "without a valid cookie everything redirects to the
 * form", and a test that only checks *that* would pass against a gate with no
 * lock in it — a cookie called `authenticated=1` also redirects everyone who
 * lacks it. So the negative half is tested too: what a forged cookie does,
 * what a missing configuration does, and where the redirect is allowed to send
 * somebody.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  COOKIE_NAME,
  cookieOptions,
  gateDecision,
  isPublicPath,
  OPEN_SENTINEL,
  passwordMatches,
  readGateConfig,
  safeReturnPath,
  sameToken,
  sessionToken,
} from './auth.ts';

const PASSWORD = 'una-clave-larga-y-compartida';
const GATED = { kind: 'gated', password: PASSWORD } as const;
const good = sessionToken(PASSWORD);

describe('the switch that HU-07 asks for', () => {
  it('a password means gated', () => {
    assert.deepEqual(readGateConfig(PASSWORD), { kind: 'gated', password: PASSWORD });
  });

  it('the literal "off" opens the site — config change, not a code change', () => {
    assert.deepEqual(readGateConfig(OPEN_SENTINEL), { kind: 'open' });
  });

  it('an UNSET variable is not "open", it is misconfigured', () => {
    // The likeliest accident of the private period is deploying without the
    // variable. If that meant open, the accident would publish the site
    // silently — which is the one thing HU-07 exists to prevent.
    assert.deepEqual(readGateConfig(undefined), { kind: 'misconfigured' });
    assert.deepEqual(readGateConfig(''), { kind: 'misconfigured' });
    assert.deepEqual(readGateConfig('   '), { kind: 'misconfigured' });
  });
});

describe('without a valid cookie, everything goes to the form', () => {
  it('redirects a visitor with no cookie', () => {
    const decision = gateDecision({ pathname: '/', cookie: undefined, config: GATED });
    assert.equal(decision.kind, 'redirect');
    assert.ok(decision.kind === 'redirect');
    assert.ok(decision.to.startsWith('/entrar'));
  });

  it('redirects every page, not just the home one', () => {
    for (const path of ['/', '/proveedores/wise', '/trm', '/lo-que-sea']) {
      assert.equal(
        gateDecision({ pathname: path, cookie: undefined, config: GATED }).kind,
        'redirect',
      );
    }
  });

  it('remembers where they were going', () => {
    const decision = gateDecision({
      pathname: '/proveedores/wise',
      cookie: undefined,
      config: GATED,
    });
    assert.ok(decision.kind === 'redirect');
    assert.equal(decision.to, '/entrar?volver=%2Fproveedores%2Fwise');
  });

  it('lets a valid cookie through', () => {
    assert.equal(gateDecision({ pathname: '/', cookie: good, config: GATED }).kind, 'allow');
  });
});

describe('the lock is a lock, not a label', () => {
  // The half that a "does it redirect?" test cannot see.

  it('a made-up cookie value does NOT open it', () => {
    for (const forged of ['1', 'true', 'si', 'authenticated', COOKIE_NAME, '']) {
      const decision = gateDecision({ pathname: '/', cookie: forged, config: GATED });
      assert.equal(decision.kind, 'redirect', `"${forged}" must not be accepted`);
    }
  });

  it('the cookie never contains the password', () => {
    assert.ok(!good.includes(PASSWORD));
    assert.match(good, /^[0-9a-f]{64}$/);
  });

  it('a token for another password does not open this one', () => {
    const other = sessionToken('otra-clave-distinta');
    assert.equal(gateDecision({ pathname: '/', cookie: other, config: GATED }).kind, 'redirect');
  });

  it('the same password always derives the same token', () => {
    // Otherwise every deploy would log the owner out.
    assert.equal(sessionToken(PASSWORD), sessionToken(PASSWORD));
  });

  it('compares without leaking through length', () => {
    assert.equal(sameToken(good, good), true);
    assert.equal(sameToken(good, `${good}x`), false);
    assert.equal(sameToken('', ''), true);
  });

  it('accepts the right password and rejects a near miss', () => {
    assert.equal(passwordMatches(PASSWORD, PASSWORD), true);
    assert.equal(passwordMatches(`${PASSWORD} `, PASSWORD), false);
    assert.equal(passwordMatches(PASSWORD.toUpperCase(), PASSWORD), false);
    assert.equal(passwordMatches('', PASSWORD), false);
  });
});

describe('a misconfigured deployment refuses everything', () => {
  it('including the login form itself', () => {
    // Serving the form under a blank SITE_PASSWORD would mean guessing which
    // side of the private period we are on. There is no password to check
    // against, so there is nothing honest to render.
    for (const path of ['/', '/entrar', '/_astro/x.css']) {
      const decision = gateDecision({
        pathname: path,
        cookie: good,
        config: { kind: 'misconfigured' },
      });
      assert.equal(decision.kind, 'misconfigured');
    }
  });
});

describe('the public paths, and why each one is public', () => {
  it('lets the form through, or the redirect would loop', () => {
    assert.equal(isPublicPath('/entrar'), true);
    assert.equal(
      gateDecision({ pathname: '/entrar', cookie: undefined, config: GATED }).kind,
      'allow',
    );
  });

  it('lets through what the form needs to render', () => {
    assert.equal(isPublicPath('/_astro/entrar.CH4sd.css'), true);
    assert.equal(isPublicPath('/logo-32.png'), true);
    assert.equal(isPublicPath('/logo-64.png'), true);
    assert.equal(isPublicPath('/logo-180.png'), true);
  });

  it('opens the logo files it names and nothing else shaped like them', () => {
    // Listed one by one on purpose: a '/logo-' prefix would have opened this
    // too, and the gate is the one place a convenience is not worth it.
    assert.equal(isPublicPath('/logo-secreto.png'), false);
    assert.equal(isPublicPath('/logo-32.png.bak'), true, 'prefix match is how the list works');
  });

  it('does not let a page through by starting with a public-ish name', () => {
    // '/entrar' is a prefix of '/entrarnos', and a careless check would open it.
    assert.equal(
      gateDecision({ pathname: '/trm', cookie: undefined, config: GATED }).kind,
      'redirect',
    );
    assert.equal(
      gateDecision({ pathname: '/proveedores', cookie: undefined, config: GATED }).kind,
      'redirect',
    );
  });

  it('opens everything when the gate is off', () => {
    assert.equal(
      gateDecision({ pathname: '/', cookie: undefined, config: { kind: 'open' } }).kind,
      'allow',
    );
  });
});

describe('the return path cannot be used to bounce someone off the site', () => {
  it('keeps a same-site path', () => {
    assert.equal(safeReturnPath('/proveedores/wise'), '/proveedores/wise');
  });

  it('refuses an absolute URL', () => {
    assert.equal(safeReturnPath('https://evil.example'), '/');
    assert.equal(safeReturnPath('http://evil.example'), '/');
  });

  it('refuses a protocol-relative URL, which is the one that gets missed', () => {
    // '//evil.example' starts with '/', so a naive check calls it same-site.
    assert.equal(safeReturnPath('//evil.example'), '/');
  });

  it('refuses nothing at all', () => {
    assert.equal(safeReturnPath(null), '/');
    assert.equal(safeReturnPath(''), '/');
  });

  it('never builds a redirect to another origin', () => {
    const decision = gateDecision({
      pathname: '//evil.example',
      cookie: undefined,
      config: GATED,
    });
    assert.ok(decision.kind === 'redirect');
    assert.equal(decision.to, '/entrar?volver=%2F');
  });
});

describe('the cookie flags', () => {
  it('is httpOnly, lax and site-wide', () => {
    const options = cookieOptions(true);
    assert.equal(options.httpOnly, true);
    assert.equal(options.sameSite, 'lax');
    assert.equal(options.path, '/');
    assert.ok(options.maxAge > 0);
  });

  it('is Secure in production and not in dev, where there is no TLS', () => {
    assert.equal(cookieOptions(true).secure, true);
    assert.equal(cookieOptions(false).secure, false);
  });
});
