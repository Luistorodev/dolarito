/**
 * Exercises both references against the live network (T010, T011).
 *
 * The unit tests run off saved fixtures, which is right — they must not depend
 * on the network (Art. VII.3). But a fixture cannot tell you the endpoint still
 * exists, still answers a plain identifiable User-Agent, and still returns the
 * shape the adapter reads.
 *
 * **The third check is the point of this script.** The er-api fallback is the
 * path that runs on the day Yahoo changes, which is the day nobody is watching.
 * A fallback that has only ever been exercised with a stub is a guess about the
 * future. Here Yahoo is failed deliberately — only Yahoo, by URL — while er-api
 * goes out over the real network.
 *
 * Read-only. It writes nothing, anywhere.
 */

import { createMidMarketAdapter, ER_API_URL, YAHOO_URL } from '../references/mid-market.ts';
import { createTrmAdapter } from '../references/trm.ts';

const failures: string[] = [];

function check(condition: boolean, message: string): void {
  console.log(`  ${condition ? 'ok  ' : 'FAIL'}  ${message}`);
  if (!condition) failures.push(message);
}

/** Real network, except for the URLs named — those fail as if the host were down. */
function failOnly(urls: string[]): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    if (urls.some((blocked) => String(url).startsWith(blocked.split('?')[0] ?? blocked))) {
      throw new TypeError('fetch failed (simulated outage for this check)');
    }
    return fetch(url, init);
  }) as unknown as typeof fetch;
}

function ageInHours(iso: string | undefined): number {
  if (iso === undefined) return Number.NaN;
  return (Date.now() - Date.parse(iso)) / 3_600_000;
}

async function main(): Promise<void> {
  console.log('TRM (datos.gov.co):');
  try {
    const trm = await createTrmAdapter().fetchReference();
    check(trm.value > 0, `value ${trm.value}`);
    check(trm.source === 'datos_gov', `source ${trm.source}`);
    check(
      trm.valid_from !== undefined && trm.valid_to !== undefined,
      `in force ${trm.valid_from} -> ${trm.valid_to}`,
    );
    const spanDays =
      (Date.parse(`${trm.valid_to}T00:00:00Z`) - Date.parse(`${trm.valid_from}T00:00:00Z`)) /
        86_400_000 +
      1;
    console.log(`  note  the window spans ${spanDays} day(s), read off the datum`);
  } catch (error) {
    check(false, `TRM failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  console.log('');
  console.log('mid-market, primary (Yahoo):');
  try {
    const mid = await createMidMarketAdapter().fetchReference();
    check(mid.source === 'yahoo', `mid_market_src is '${mid.source}'`);
    check(mid.value > 0, `value ${mid.value}`);
    check(mid.observed_at !== undefined, `observed_at ${mid.observed_at}`);
    console.log(`  note  the datum is ${ageInHours(mid.observed_at).toFixed(1)}h old at capture`);
  } catch (error) {
    check(false, `Yahoo failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  console.log('');
  console.log('mid-market, FALLBACK exercised for real (Yahoo blocked, er-api live):');
  try {
    let fellBack = false;
    const mid = await createMidMarketAdapter({
      fetchImpl: failOnly([YAHOO_URL]),
      maxAttempts: 1,
      onFallback: () => {
        fellBack = true;
      },
    }).fetchReference();

    check(fellBack, 'the primary failed and the fallback was reached');
    check(mid.source === 'er_api', `mid_market_src is '${mid.source}', not a stale 'yahoo'`);
    check(mid.value > 0, `value ${mid.value} came from er-api over the real network`);
    check(mid.observed_at !== undefined, `observed_at ${mid.observed_at}`);
    console.log(`  note  the datum is ${ageInHours(mid.observed_at).toFixed(1)}h old at capture`);
  } catch (error) {
    check(false, `the fallback failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  console.log('');
  console.log('both down is an incident, and says so:');
  try {
    await createMidMarketAdapter({
      fetchImpl: failOnly([YAHOO_URL, ER_API_URL]),
      maxAttempts: 1,
    }).fetchReference();
    check(false, 'it should have thrown with both sources down');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    check(message.includes('both sources failed'), 'it names both, not just the fallback');
  }

  console.log('');
  if (failures.length > 0) {
    console.error(`REFERENCES FAILED (${failures.length}): ${failures.join('; ')}`);
    process.exitCode = 1;
    return;
  }
  console.log('Both references answer live, and the fallback works against the real er-api.');
}

await main();
