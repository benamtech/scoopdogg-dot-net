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
for (const p of pages) {
  const out = `output/lighthouse/${p === '/' ? 'home' : p.replace(/\//g, '_').slice(1)}.json`;
  try {
    execFileSync('npx', ['-y', 'lighthouse@12', `${base}${p}`, '--quiet', '--output=json', `--output-path=${out}`,
      '--only-categories=performance,accessibility,best-practices,seo', '--chrome-flags=--headless=new --no-sandbox'], { stdio: 'pipe', timeout: 180000 });
  } catch (e) { console.log(`  FAIL  ${p} lighthouse did not run: ${String(e.stderr || e.message).slice(0, 160)}`); failed++; continue; }
  const r = JSON.parse(readFileSync(out, 'utf8'));
  const perf = Math.round(r.categories.performance.score * 100);
  const a11y = Math.round(r.categories.accessibility.score * 100);
  const bp = Math.round(r.categories['best-practices'].score * 100);
  const seo = Math.round(r.categories.seo.score * 100);
  const lcp = Math.round(r.audits['largest-contentful-paint'].numericValue);
  const cls = Math.round(r.audits['cumulative-layout-shift'].numericValue * 1000) / 1000;
  const ok = perf >= 85 && a11y >= 95 && lcp < 2500 && cls < 0.1;
  if (!ok) failed++;
  const a11yFails = Object.values(r.audits).filter((a) => a.score === 0 && r.categories.accessibility.auditRefs.some((x) => x.id === a.id)).map((a) => a.id);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${p.padEnd(42)} perf ${perf}  a11y ${a11y}  bp ${bp}  seo ${seo}  LCP ${lcp}ms  CLS ${cls}${a11yFails.length ? `  a11y issues: ${a11yFails.join(', ')}` : ''}`);
}
console.log(failed ? `FAIL ${failed}/${pages.length}` : `PASS ${pages.length}/${pages.length}`);
process.exit(failed ? 1 : 0);
