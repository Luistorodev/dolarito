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
 * The rendered mark, not the word.
 *
 * `desactualizado` also appears inside the page's inlined <style>, as the
 * content of a ::before rule, so searching for the word matches a healthy page
 * too. The class on the element is what actually distinguishes them — and this
 * check failed the first time for exactly that reason.
 *
 * It is coupled to a class name, which is the price of checking rendered
 * output: T025 renamed the row markup and this went red before the page did
 * anything wrong. That is the check doing its job loudly rather than quietly
 * matching nothing.
 */
const STALE_MARK = 'edad vieja';

/** Minutes of age per provider, swapped between scenarios. */
let ages: Record<string, number> = {};

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
    amount_out: 306_550,
    currency_out: 'COP',
    status: 'ok',
    limit_reason: null,
    gross_rate: 3065.5,
    effective_rate: 3065.5,
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
