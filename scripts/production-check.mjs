/**
 * The production checks, run automatically. Nobody has to remember them.
 *
 *   node scripts/production-check.mjs --deploy [--alert]   # after every production deployment
 *   node scripts/production-check.mjs --daily  [--alert]   # every morning, after the daily cron
 *
 * WHO RUNS IT. .github/workflows/production-check.yml, on two triggers:
 *   - Vercel reports a production deployment of the `scoopdogg` project as successful
 *     (GitHub's deployment_status event) -> --deploy. The merge to main is such a deployment, so
 *     everything that used to be an "after-merge checklist" happens by itself the moment it lands.
 *   - a schedule, daily at 15:30 UTC, an hour after the site's own cron -> --daily.
 * A human can run either by hand (npm run production-check, npm run health) with the same result.
 *
 * WHAT IT CHECKS
 *   deploy: the site and its routes answer; the webhook route is the handler (400, not 404); both
 *           Stripe Connect endpoints are enabled and point at the site; Search Console ownership is
 *           verified and the sitemap submitted; the admin, signed in, in a browser, at desktop and
 *           phone size, against production itself.
 *   daily:  the site and webhook route answer; the daily cron ran in the last 26 hours and every
 *           step reported without an error; the Stripe endpoints are still enabled.
 *
 * --alert emails Ben the full result if anything fails, through the site's own mail path (a
 * logged `ops_alert` in the outbox). The repository is public, so the console prints only one line
 * per check; the detail, which can name customers, goes only in the email.
 *
 * It never resends a Stripe event. The 80 undelivered test-mode events from 2026-09-23..27 came from
 * gate runs whose rows were removed; replaying them would write test rows into production.
 */
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { loadEnv } from './_env.mjs';
import { compileServer } from '../gates/_compile.mjs';

loadEnv();
const MODE = process.argv.includes('--daily') ? 'daily' : 'deploy';
const ALERT = process.argv.includes('--alert');
const SITE = process.env.PRODUCTION_URL || 'https://scoopdogg.net';
const results = [];
const say = (ok, what, detail = '') => {
  results.push({ ok, what, detail });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${what}`);
};
const run = (cmd, args, timeout = 600_000) => {
  try { return { ok: true, out: execFileSync(cmd, args, { encoding: 'utf8', timeout, stdio: ['ignore', 'pipe', 'pipe'], env: process.env }) }; }
  catch (e) { return { ok: false, out: `${e.stdout ?? ''}${e.stderr ?? ''}` }; }
};
const last = (s) => s.trim().split('\n').filter(Boolean).pop() ?? '';
const sql = (q) => last(run('node', ['scripts/sql-read.mjs', q], 60_000).out);

// ---- the site answers as it should
for (const [p, want] of [['/', 200], ['/quote/production-check', 200], ['/sitemap-0.xml', 200], ['/no-such-page', 404]]) {
  const r = await fetch(SITE + p, { redirect: 'manual' }).catch((e) => ({ status: `no answer (${e.message})` }));
  say(r.status === want, `${p} answers ${want}`, String(r.status));
}
{
  const r = await fetch(`${SITE}/api/stripe-webhook`, { method: 'POST', body: '{}' }).catch(() => null);
  const body = r ? await r.text() : '';
  say(r?.status === 400 && /signature/i.test(body), 'the Stripe webhook route is the handler (400 without a signature, not 404)', `${r?.status} ${body.slice(0, 60)}`);
}
for (const mode of ['live', 'test']) {
  const out = run('node', ['scripts/register-webhook.mjs', '--mode', mode], 120_000).out;
  say(/enabled\s+connect=true\s+https:\/\/scoopdogg\.net\/api\/stripe-webhook/.test(out), `the ${mode} Stripe Connect endpoint is enabled and points at the site`, last(out));
}

if (MODE === 'deploy') {
  const sc = run('node', ['scripts/search-console.mjs', 'verify'], 180_000);
  say(sc.ok && !/not yet|error/i.test(sc.out), 'Search Console ownership verified and the sitemap submitted', last(sc.out));
  for (const g of ['admin-browser', 'admin-phone']) {
    const r = run('node', [`gates/${g}.mjs`, SITE], 900_000);
    say(r.ok, `${g} against production`, r.out.split('\n').filter((l) => /FAIL|══|^PASS|^FAIL/.test(l)).slice(0, 12).join('\n'));
  }
}

if (MODE === 'daily') {
  const row = sql(`select value->>'at' as at, value->>'by' as by, value->'results' as results,
                          extract(epoch from now() - (value->>'at')::timestamptz) / 3600 as hours
                     from settings where key = 'daily.last_run'`);
  let rec = null; try { rec = JSON.parse(row); } catch {}
  const fresh = rec && rec.by === 'cron' && Number(rec.hours) < 26;
  say(!!fresh, 'the daily cron ran in production in the last 26 hours', rec ? `${rec.at} by ${rec.by}` : 'no run recorded');
  const errors = rec?.results ? Object.entries(rec.results).filter(([, v]) => v && typeof v === 'object' && v.error).map(([k]) => k) : [];
  say(!!rec && errors.length === 0, 'every step of the daily run finished without an error', errors.join(', ') || 'none');
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${failed.length ? 'FAIL' : 'PASS'}  ${MODE}: ${results.length - failed.length} passed, ${failed.length} failed`);

if (failed.length && ALERT) {
  const build = compileServer({ dir: '.check-build' });
  const { sendEmail } = await import(path.resolve(build, 'server/lib/notify.js'));
  const { db } = await import(path.resolve(build, 'server/lib/db.js'));
  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const r = await sendEmail({
    purpose: 'ops_alert', recipients: { explicit: ['ben@amtechai.com'] }, fromName: 'Scoop Dogg site check',
    subject: `Scoop Dogg ${MODE} check: ${failed.length} failed`,
    html: `<div style="font-family:system-ui,sans-serif;max-width:640px"><p>The ${MODE} check of ${SITE} found ${failed.length} problem(s).</p>
      <ul>${failed.map((f) => `<li><strong>${esc(f.what)}</strong><pre style="white-space:pre-wrap">${esc(f.detail)}</pre></li>`).join('')}</ul>
      <p>${results.length - failed.length} other checks passed.</p></div>`,
  }).catch((e) => ({ state: 'failed', error: e.message }));
  console.log(`  alert to Ben: ${r.state}`);
  await db().end().catch(() => {});
}
process.exit(failed.length ? 1 : 0);
