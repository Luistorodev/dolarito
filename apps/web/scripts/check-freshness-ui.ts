/**
 * `pnpm check:freshness` — does the stale mark actually appear on the page?
 *
 * T026's done criterion is "forcing an old datum makes the mark appear", and
 * that is a claim about rendered HTML, not about a function. The unit tests
 * prove `describeFreshness` classifies correctly; this proves the page acts on
 * the classification.
 *
 * It stands up a stub that answers like PostgREST, points the dev server at it,
 * and renders three situations whose only difference is how old the rows are:
 *
 *  1. everything recent          -> no mark, no notice
 *  2. one provider behind        -> that row marked, others not
 *  3. everything behind          -> ONE notice about the capture, not eight
 *
 * The third is the case worth a script. Eight stale badges and "the capture
 * stopped" look similar and mean opposite things — chase the providers, or look
 * at the scheduler. It is the mistake check:silence made on 2026-09-14, in the
 * form a reader would see.
 */

import { execFileSync, spawn } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { dirname, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const APP = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const STUB_PORT = 4401;
const WEB_PORT = 4402;
const PASSWORD = 'clave-de-verificacion';

/**
 * The rendered mark, as a contract rather than as a class name.
 *
 * Two attempts got this wrong before it got it right, and both are worth
 * keeping written down because they are opposite failures:
 *
 *  1. **Searching for the word `desactualizado`** matched a healthy page too,
 *     because the word also sat inside the inlined <style> as the content of a
 *     ::before rule. A check that matches everything reports nothing.
 *  2. **Searching for the class `edad vieja`** worked, right up until the
 *     styling changed. It went red on 2026-09-16 when the ranking moved to
 *     utility classes and the row stopped being called that — the page was
 *     correct and the check was wrong. That is the check doing its job loudly
 *     rather than quietly matching nothing, but it is still a false red, and a
 *     false red teaches people to ignore the alarm.
 *
 * So the hook is now a `data-` attribute the component sets on purpose. A
 * class name is a styling decision and will change again; `data-stale` is a
 * statement about the row that only changes when the meaning does. It is
 * rendered only when the row is actually stale, so the negative case — "no
 * stale mark on a healthy page" — stays just as strong.
 */
const STALE_MARK = 'data-stale="true"';

/** Minutes of age per provider, swapped between scenarios. */
let ages: Record<string, number> = {};

/**
 * The marker for a row that also prints the rate the provider advertises.
 *
 * An attribute, not the word: the page's own subtitle says "no por la tasa
 * anunciada", so searching for `anuncia` matches a page showing no advertised
 * rate at all. That is the same mistake the stale mark made, kept from being
 * made twice.
 */
const ADVERTISED_MARK = 'data-advertised="true"';

/**
 * Providers whose advertised rate is not what they actually pay, per scenario.
 *
 * Exists because Art. III.1 is about ordering, so nothing in the ranking code
 * stops a future edit from printing `gross_rate` as the headline figure. That
 * edit would typecheck, render, and be wrong in the one way the article names.
 */
let charged: Record<string, { gross: number; effective: number; amountOut: number }> = {};

/**
 * A three-day TRM window that contains today in Bogotá.
 *
 * Fixed dates do not work here: a window that ended yesterday is correctly
 * reported as stale rather than frozen, which is what this got wrong on its
 * first run. The frozen case needs a rate that is still in force.
 */
function trmWindow(): { from: string; to: string } {
  const bogota = new Date(Date.now() - 5 * 3_600_000);
  const day = (offset: number) =>
    new Date(bogota.getTime() + offset * 86_400_000).toISOString().slice(0, 10);
  return { from: day(-1), to: day(1) };
}

function row(providerId: string, minutes: number): Record<string, unknown> {
  const captured = new Date(Date.now() - minutes * 60_000).toISOString();
  const window = trmWindow();
  return {
    provider_id: providerId,
    mode: 'local',
    asset: 'usdt',
    channel: 'exchange',
    direction: 'usd_to_cop',
    bracket_usd: 100,
    payment_method: null,
    fixed_side: 'in',
    amount_in: 100,
    currency_in: 'USD',
    amount_out: charged[providerId]?.amountOut ?? 306_550,
    currency_out: 'COP',
    status: 'ok',
    limit_reason: null,
    gross_rate: charged[providerId]?.gross ?? 3065.5,
    effective_rate: charged[providerId]?.effective ?? 3065.5,
    fee_pct: null,
    fee_fixed_usd: null,
    fee_amount_usd: null,
    amounts_source: 'computed',
    eta_minutes: null,
    captured_at: captured,
    trm: 3109.3,
    trm_from: window.from,
    trm_to: window.to,
    mid_market: 3105.99,
    mid_market_src: 'yahoo',
    mid_market_at: captured,
    markup_vs_trm: 0.014,
    markup_vs_mid: 0.013,
  };
}

function startStub(): Server {
  const server = createServer((_request, response) => {
    const body = Object.entries(ages).map(([id, minutes]) => row(id, minutes));
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(body));
  });
  server.listen(STUB_PORT);
  return server;
}

async function render(): Promise<string> {
  const cookie = `dolarito_acceso=${createHmac('sha256', PASSWORD).update('dolarito-session-v1').digest('hex')}`;
  const response = await fetch(`http://localhost:${WEB_PORT}/`, { headers: { cookie } });
  return response.text();
}

type Check = { label: string; pass: boolean };

function expect(label: string, pass: boolean): Check {
  console.log(`    ${pass ? '✔' : '✖'} ${label}`);
  return { label, pass };
}

async function main(): Promise<void> {
  const stub = startStub();

  spawn('npx', ['astro', 'dev', '--port', String(WEB_PORT)], {
    cwd: APP,
    env: {
      ...process.env,
      SITE_PASSWORD: PASSWORD,
      SUPABASE_URL: `http://localhost:${STUB_PORT}`,
      SUPABASE_SERVER_READ_KEY: 'stub-key-not-a-secret',
    },
    stdio: 'ignore',
    shell: true,
  });

  const checks: Check[] = [];

  try {
    let ready = false;
    for (let attempt = 0; attempt < 40 && !ready; attempt += 1) {
      await sleep(500);
      try {
        await fetch(`http://localhost:${WEB_PORT}/entrar`);
        ready = true;
      } catch {
        // not up yet
      }
    }
    if (!ready) throw new Error('dev server did not start');

    console.log('\n1. everything recent');
    ages = { bitso: 3, buda: 5, dolarapp: 8 };
    let html = await render();
    checks.push(expect('no stale mark', !html.includes(STALE_MARK)));
    checks.push(expect('no capture notice', !html.includes('La captura no está corriendo')));
    checks.push(expect('capture times are shown anyway', html.includes('hace 3 min')));
    checks.push(expect('the rate per dollar is shown', html.includes('COP por dólar')));
    checks.push(
      // When the two rates round to the same figure, printing both is noise.
      expect('no advertised rate when it matches', !html.includes(ADVERTISED_MARK)),
    );

    console.log('\n2. one provider behind, the rest current');
    ages = { bitso: 3, buda: 5, dolarapp: 240 };
    html = await render();
    checks.push(expect('the stale mark appears', html.includes(STALE_MARK)));
    checks.push(expect('it names the lagging provider', html.includes('DolarApp (hace 4 h)')));
    checks.push(
      expect('it does NOT blame the capture', !html.includes('La captura no está corriendo')),
    );

    console.log('\n3. everything behind — our outage, not eight failures');
    ages = { bitso: 300, buda: 305, dolarapp: 310 };
    html = await render();
    checks.push(
      expect('one notice about the capture', html.includes('La captura no está corriendo')),
    );
    checks.push(
      expect('NOT a list of lagging providers', !html.includes('proveedores están atrasados')),
    );

    console.log('\n4. the TRM block (T024)');
    checks.push(expect('shows the value', html.includes('3.109,30')));
    checks.push(expect('shows the day it rules', html.includes(trmWindow().to)));
    checks.push(expect('marks the weekend rate frozen', html.includes('cubre 3 días')));
    checks.push(expect('explains why no app offers it', html.includes('Ninguna app te la ofrece')));

    // ---------------------------------------------------------------------
    // The shape measured on the 2026-09-16 capture: Wise advertised 3.101,
    // above a 3.099,99 mid-market, and paid 2.816,95 — 9,1 % worse. A true
    // number doing a lie's work, which is what Art. III.1 exists to stop.
    console.log('\n5. an advertised rate that is not what it pays (Art. III.1)');
    ages = { bitso: 3, buda: 5, dolarapp: 8 };
    charged = { dolarapp: { gross: 3101, effective: 2816.95, amountOut: 281_694.84 } };
    html = await render();
    checks.push(expect('the effective rate is the one printed', html.includes('2.817')));
    checks.push(
      expect('the advertised rate is marked as advertised', html.includes(ADVERTISED_MARK)),
    );
    checks.push(expect('and its figure is shown', html.includes('3.101')));
    checks.push(expect('the amount is what arrives, not rate x bracket', html.includes('281.695')));
    checks.push(
      // 3101 x 100 = 310.100. If this ever appears, the headline switched to
      // the advertised rate and the ranking now contradicts its own numbers.
      expect('the advertised rate never becomes the headline', !html.includes('310.100')),
    );
  } finally {
    stub.close();
    execFileSync('npx', ['astro', 'dev', 'stop'], { cwd: APP, stdio: 'ignore', shell: true });
  }

  const failed = checks.filter((check) => !check.pass);
  if (failed.length > 0) {
    console.error(`\n${failed.length} of ${checks.length} checks FAILED`);
    process.exitCode = 1;
    return;
  }
  console.log(`\nAll ${checks.length} checks passed.`);
}

await main();
