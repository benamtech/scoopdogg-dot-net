/**
 * S18: fast, stable, accessible on a phone. Lighthouse (mobile, simulated throttling) on the
 * templates that sell: home, pricing, a service, a city, booking.
 *
 *   node gates/lighthouse.mjs [--base http://127.0.0.1:4330]
 *
 * Thresholds: performance >= 85, accessibility >= 95, LCP < 2500ms, CLS < 0.1.
 * Uses Playwright's Chromium so the run needs no system Chrome. Local numbers exclude the CDN,
 * so they are a floor for what production serves, not a promise about it.
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const base = process.argv.includes('--base') ? process.argv[process.argv.indexOf('--base') + 1] : 'http://127.0.0.1:4330';
const chromeDir = path.join(os.homedir(), '.cache/ms-playwright');
const chrome = readdirSync(chromeDir).filter((d) => d.startsWith('chromium-')).sort().pop();
process.env.CHROME_PATH = path.join(chromeDir, chrome, 'chrome-linux64/chrome');
mkdirSync('output/lighthouse', { recursive: true });
const pages = ['/', '/pricing', '/services/weekly-pooper-scooper-service', '/areas/ventura', '/book'];
let failed = 0;
const summary = [];
// Lighthouse's own guidance: one run is noise; take the median of several. Measured here on
// 2026-09-16 - the same page scored 99 and 83 on consecutive single runs.
const RUNS = Number(process.env.LH_RUNS || 3);
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

/**
 * A BUSY MACHINE CANNOT MEASURE A WEBSITE, and a gate that reports its own noise as a failure
 * teaches everybody to ignore it.
 *
 * Measured 2026-09-19: the same five pages scored 85-87 with a load average near 1 and 46-81
 * an hour later with a load average of 6.4 — Firefox, another agent and the desktop all
 * running. One page reported a 7.9-second LCP, which is a stalled CPU rather than a website.
 * Lighthouse throttles the CPU by a fixed multiplier; it cannot tell throttling from
 * contention, so it reports contention as a slow site.
 *
 * So: above the threshold this REFUSES to measure and exits UNKNOWN. Unknown is a third answer
 * and it is the honest one — the same reason `demo-negative-control.mjs` reports unknown on a
 * timeout instead of passing. `--force` runs anyway and says so on every line.
 *
 * The number is per-core: load average 1.0 per core means the machine is fully committed
 * before Lighthouse starts.
 */
const CORES = os.cpus().length;
const LOAD_LIMIT = Number(process.env.LH_LOAD_LIMIT ?? (CORES * 0.35).toFixed(2));
const load1 = os.loadavg()[0];
const forced = process.argv.includes('--force');
console.log(`  machine: ${CORES} cores, load average ${load1.toFixed(2)} (limit ${LOAD_LIMIT})`);
if (load1 > LOAD_LIMIT && !forced) {
  console.log('  UNKNOWN  the machine is too busy to measure a website.');
  console.log('           Nothing was measured, and a number taken now would be about this box,');
  console.log('           not about the site. Close what is running, or re-run with --force and');
  console.log('           treat the result as a floor rather than a score.');
  console.log('UNKNOWN 0/0');
  process.exit(2);
}
if (forced && load1 > LOAD_LIMIT) console.log('  --force: measuring anyway. Every number below is contaminated by other processes.');
for (const p of pages) {
  const runs = [];
  for (let i = 0; i < RUNS; i++) {
    const out = `output/lighthouse/${p === '/' ? 'home' : p.replace(/\//g, '_').slice(1)}.${i}.json`;
    try {
      execFileSync('npx', ['-y', 'lighthouse@12', `${base}${p}`, '--quiet', '--output=json', `--output-path=${out}`,
        '--only-categories=performance,accessibility,best-practices,seo', '--chrome-flags=--headless=new --no-sandbox'], { stdio: 'pipe', timeout: 180000 });
      const r = JSON.parse(readFileSync(out, 'utf8'));
      runs.push({
        perf: Math.round(r.categories.performance.score * 100), a11y: Math.round(r.categories.accessibility.score * 100),
        bp: Math.round(r.categories['best-practices'].score * 100), seo: Math.round(r.categories.seo.score * 100),
        lcp: Math.round(r.audits['largest-contentful-paint'].numericValue), cls: Math.round(r.audits['cumulative-layout-shift'].numericValue * 1000) / 1000,
      });
    } catch (e) { console.log(`  run ${i} of ${p} did not complete: ${String(e.stderr || e.message).slice(0, 120)}`); }
  }
  if (!runs.length) { failed++; console.log(`  FAIL  ${p} no Lighthouse run completed`); continue; }
  const m = Object.fromEntries(['perf', 'a11y', 'bp', 'seo', 'lcp', 'cls'].map((k) => [k, median(runs.map((r) => r[k]))]));
  const ok = m.perf >= 85 && m.a11y >= 95 && m.lcp < 2500 && m.cls < 0.1;
  if (!ok) failed++;
  summary.push({ page: p, ok, runs: runs.length, ...m });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${p.padEnd(42)} median of ${runs.length}: perf ${m.perf}  a11y ${m.a11y}  bp ${m.bp}  seo ${m.seo}  LCP ${m.lcp}ms  CLS ${m.cls}  (perf runs ${runs.map((r) => r.perf).join('/')})`);
}
(await import('node:fs')).writeFileSync('output/lighthouse/receipt.json', JSON.stringify({
  ran_at: new Date().toISOString(), base, failed, summary,
  // A score without the machine's state beside it is not a measurement anybody can check later.
  machine: { cores: CORES, load_at_start: Number(load1.toFixed(2)), load_at_finish: Number(os.loadavg()[0].toFixed(2)), forced },
}, null, 2));
console.log(`  machine at finish: load average ${os.loadavg()[0].toFixed(2)}`);
console.log(failed ? `FAIL ${failed}/${pages.length}` : `PASS ${pages.length}/${pages.length}`);
process.exit(failed ? 1 : 0);
