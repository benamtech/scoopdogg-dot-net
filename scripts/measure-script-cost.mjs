/**
 * What the third-party tag costs, measured directly instead of inferred from a Lighthouse score.
 *
 *   node scripts/dev-server.mjs --port 4330 &
 *   node scripts/measure-script-cost.mjs [--base http://127.0.0.1:4330] [--samples 5]
 *
 * WHY THIS EXISTS RATHER THAN ANOTHER LIGHTHOUSE RUN. A Lighthouse performance score on a
 * shared 4-core workstation is mostly a measurement of the workstation: the same page scored
 * 70, 90 and 90 in three consecutive runs. Asking "does removing Google Analytics reach 90"
 * on this machine cannot be answered honestly today.
 *
 * But that is not the question that matters. The question is **what does the tag cost**, and
 * that has a nearly deterministic answer: the bytes it downloads and the milliseconds the main
 * thread spends compiling and running them. Both come straight from Chrome — the network log
 * and `Performance.getMetrics` — and neither is a composite score with a curve applied to it.
 *
 * It measures the SAME page twice in the same minute, once with the tag's requests allowed and
 * once with them blocked at the network layer, so whatever else the machine is doing lands on
 * both arms. That is the A/B a score cannot give you.
 *
 * It reports the MEDIAN of n samples per arm and the spread, and it says plainly when the
 * spread is wide enough that the difference is not readable.
 */
import { chromium } from 'playwright';

const arg = (f, d) => { const i = process.argv.indexOf(f); return i > -1 ? process.argv[i + 1] : d; };
const BASE = arg('--base', 'http://127.0.0.1:4330');
const SAMPLES = Number(arg('--samples', 5));
const PAGES = ['/', '/areas/ventura', '/pricing'];

// The hosts the tag lives on. Blocking at the network layer measures the counterfactual
// without rebuilding the site, so both arms run against byte-identical HTML.
const TAG_HOSTS = ['googletagmanager.com', 'google-analytics.com'];

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const spread = (xs) => Math.max(...xs) - Math.min(...xs);

/** One load. Returns script bytes over the wire and main-thread script time in ms. */
async function sample(browser, url, blockTag) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  let jsBytes = 0, tagBytes = 0, tagRequests = 0;

  if (blockTag) {
    await page.route('**/*', (route) => {
      const u = route.request().url();
      return TAG_HOSTS.some((h) => u.includes(h)) ? route.abort() : route.continue();
    });
  }
  page.on('response', async (res) => {
    const type = res.request().resourceType();
    const url = res.url();
    if (type !== 'script') return;
    const len = Number(res.headers()['content-length'] ?? 0);
    jsBytes += len;
    if (TAG_HOSTS.some((h) => url.includes(h))) { tagBytes += len; tagRequests++; }
  });

  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  await page.goto(`${BASE}${url}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  // The tag loads on idle or first interaction. Give it both, then let it settle — otherwise
  // the "with tag" arm measures a page the tag never reached and the comparison is empty.
  await page.mouse.move(200, 400);
  await page.evaluate(() => window.scrollTo(0, 400));
  await page.waitForTimeout(5000);

  const metrics = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
  await page.close();
  return {
    scriptMs: Math.round((metrics.ScriptDuration ?? 0) * 1000),
    taskMs: Math.round((metrics.TaskDuration ?? 0) * 1000),
    layoutMs: Math.round((metrics.LayoutDuration ?? 0) * 1000),
    jsKB: Math.round(jsBytes / 1024),
    tagKB: Math.round(tagBytes / 1024),
    tagRequests,
  };
}

const browser = await chromium.launch();
console.log(`${SAMPLES} samples per arm, against ${BASE}\n`);
console.log('page                  arm        script ms (median, spread)   total task ms   JS KB   tag KB');

const table = [];
for (const route of PAGES) {
  const arms = {};
  for (const [label, block] of [['tag on', false], ['tag off', true]]) {
    const runs = [];
    for (let i = 0; i < SAMPLES; i++) runs.push(await sample(browser, route, block));
    arms[label] = {
      scriptMs: median(runs.map((r) => r.scriptMs)), scriptSpread: spread(runs.map((r) => r.scriptMs)),
      taskMs: median(runs.map((r) => r.taskMs)),
      jsKB: median(runs.map((r) => r.jsKB)), tagKB: median(runs.map((r) => r.tagKB)),
      tagRequests: median(runs.map((r) => r.tagRequests)),
    };
    const a = arms[label];
    console.log(`${route.padEnd(21)} ${label.padEnd(10)} ${String(a.scriptMs).padStart(6)}ms (±${String(a.scriptSpread).padStart(4)})        ${String(a.taskMs).padStart(6)}ms  ${String(a.jsKB).padStart(6)} ${String(a.tagKB).padStart(7)}`);
  }
  const on = arms['tag on'], off = arms['tag off'];
  const delta = on.scriptMs - off.scriptMs;
  const readable = delta > Math.max(on.scriptSpread, off.scriptSpread);
  console.log(`${' '.repeat(21)} DELTA      ${String(delta).padStart(6)}ms of main-thread script, ${on.jsKB - off.jsKB}KB` +
    (readable ? '' : `   <- NOT READABLE: the difference is inside the noise (±${Math.max(on.scriptSpread, off.scriptSpread)})`));
  console.log();
  table.push({ route, on, off, delta, readable });
}
await browser.close();

const readable = table.filter((t) => t.readable);
console.log(readable.length
  ? `The tag costs ${median(readable.map((t) => t.delta))}ms of main-thread script time at the median, on ${readable.length} of ${table.length} pages where the difference is larger than the noise.`
  : 'No page showed a difference larger than its own run-to-run noise. Either the tag is cheap here or this machine cannot resolve it.');
