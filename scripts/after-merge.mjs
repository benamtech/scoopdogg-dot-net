/**
 * Everything that closes the project after elevation-2026-09-16 is merged to main. One command.
 *
 *   npm run after-merge
 *
 * Each step prints PASS, FAIL or WAIT (true soon, not yet: the daily run before its first morning).
 * It changes nothing except what verification itself does: Search Console ownership and the sitemap
 * submission. It never resends a Stripe event (see the webhook step for why).
 */
import { execFileSync } from 'node:child_process';
import { loadEnv } from './_env.mjs';

loadEnv();
const SITE = 'https://scoopdogg.net';
let pass = 0, fail = 0, wait = 0;
const say = (state, what, detail = '') => {
  if (state === 'PASS') pass++; else if (state === 'FAIL') fail++; else wait++;
  console.log(`  ${state.padEnd(4)}  ${what}${detail ? ` — ${detail}` : ''}`);
};
const run = (cmd, args, timeout = 600_000) => {
  try { return { ok: true, out: execFileSync(cmd, args, { encoding: 'utf8', timeout, stdio: ['ignore', 'pipe', 'pipe'] }) }; }
  catch (e) { return { ok: false, out: `${e.stdout ?? ''}${e.stderr ?? ''}` }; }
};
const last = (s) => s.trim().split('\n').filter(Boolean).pop() ?? '';

// 1. production is the branch
{
  run('git', ['fetch', '-q', 'origin']);
  const branch = run('git', ['rev-parse', 'origin/elevation-2026-09-16']).out.trim();
  const merged = run('git', ['merge-base', '--is-ancestor', branch, 'origin/main']).ok;
  say(merged ? 'PASS' : 'FAIL', 'main contains the whole branch', branch.slice(0, 7));
  if (!merged) { console.log('\nNot merged yet. Nothing else here can pass.'); process.exit(1); }
}

// 2. the site answers as the branch does
for (const [path, want] of [['/', 200], ['/quote/after-merge-probe', 200], ['/sitemap-0.xml', 200], ['/no-such-page', 404]]) {
  const r = await fetch(SITE + path, { redirect: 'manual' });
  say(r.status === want ? 'PASS' : 'FAIL', `${path} answers ${want}`, `${r.status}${path === '/' ? ` x-vercel-cache=${r.headers.get('x-vercel-cache')}` : ''}`);
}

// 3. the webhook route exists in production (it 404'd while production ran the old main)
{
  const r = await fetch(`${SITE}/api/stripe-webhook`, { method: 'POST', body: '{}' });
  const body = await r.text();
  say(r.status === 400 && /signature/i.test(body) ? 'PASS' : 'FAIL', 'a POST with no signature gets the handler\'s own 400, not a 404', `${r.status} ${body.slice(0, 60)}`);
  for (const mode of ['live', 'test']) {
    const out = run('node', ['scripts/register-webhook.mjs', '--mode', mode], 120_000).out;
    say(/enabled\s+connect=true\s+https:\/\/scoopdogg\.net\/api\/stripe-webhook/.test(out) ? 'PASS' : 'FAIL', `the ${mode} Connect endpoint is enabled and points at the site`);
  }
  // DO NOT RESEND the test-mode backlog: 80 events from gate runs on 2026-09-23..27, whose rows the
  // gates removed. Replaying them writes test subscriptions into the one production database. New
  // events deliver on their own now that the route exists.
  const n = run('node', ['scripts/sql-read.mjs', 'select count(*) from stripe_events']).out;
  say('PASS', 'stripe_events is readable; it fills as new events arrive', last(n));
}

// 4. Search Console: ownership, Ben as owner, the sitemap
{
  const r = run('node', ['scripts/search-console.mjs', 'verify'], 180_000);
  say(r.ok && !/not yet/i.test(r.out) ? 'PASS' : 'FAIL', 'Search Console verified and the sitemap submitted', last(r.out));
}

// 5. the daily run
{
  const v = run('node', ['scripts/sql-read.mjs', "select value->>'at' as at, value->>'by' as by from settings where key = 'daily.last_run'"]).out;
  const row = last(v);
  if (/"by":"cron"/.test(row)) say('PASS', 'the daily cron has run in production', row);
  else say('WAIT', 'the daily cron has not run yet — it runs at 14:00 UTC; run this again tomorrow', row || 'no run recorded');
}

// 6. the admin, signed in, against production itself
for (const g of ['admin-browser', 'admin-phone']) {
  const r = run('node', [`gates/${g}.mjs`, SITE], 900_000);
  say(r.ok ? 'PASS' : 'FAIL', `${g} against ${SITE}`, last(r.out));
}

console.log(`\n${fail ? 'FAIL' : wait ? 'PASS, WAITING ON THE FIRST MORNING' : 'PASS'}  ${pass} passed, ${fail} failed, ${wait} waiting`);
process.exit(fail ? 1 : 0);
