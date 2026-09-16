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
(await import('node:fs')).writeFileSync('output/lighthouse/receipt.json', JSON.stringify({ ran_at: new Date().toISOString(), base, failed, summary }, null, 2));
console.log(failed ? `FAIL ${failed}/${pages.length}` : `PASS ${pages.length}/${pages.length}`);
process.exit(failed ? 1 : 0);
