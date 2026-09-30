/**
 * An owner's edit is on the public page in seconds, with NO new deployment. Proven on a real one.
 *
 *   node gates/live-edit.mjs <deployment-url>
 *
 * THE RULE (Ben, restated 2026-09-27): anything Josue edits in his admin is live on the public site
 * in seconds, with no rebuild and no publish button. gates/no-rebuild-path.mjs holds the structure
 * in `npm run gates`; this proves the behaviour, end to end, through the admin API a screen uses.
 *
 * WHY THE URL IS THE PROOF OF "NO DEPLOYMENT". Every request goes to the deployment's own immutable
 * URL (https://scoopdogg-<hash>-….vercel.app). A rebuild makes a NEW deployment with a NEW URL, so a
 * new value appearing at THIS one can only have come from the page rendering again from the rows.
 * The GitHub deployment list is read before and after as a second instrument.
 *
 * For each edit: warm the page until the CDN serves it from cache (x-vercel-cache: HIT), save the
 * change through the admin API, poll the page until it shows the new value (the time is reported),
 * then restore through the same API and poll until the old value is back.
 *
 * NEGATIVE CONTROL — THE MUTATION "DROP THE CACHE PURGE". The same kind of change written straight
 * to the database, which is exactly an edit with no purge, must NOT reach the cached page: the CDN
 * keeps serving the old HTML. That is what makes the purge the thing that makes an edit live, and
 * not a short cache lifetime that would also serve stale prices for its duration.
 *
 * The database is the one production also uses. Every value is restored in `finally`, and each
 * change is a single row for seconds.
 */
import pg from 'pg';
import { execFileSync } from 'node:child_process';
import { loadEnv } from '../scripts/_env.mjs';
import { adminSession } from './_admin-session.mjs';

loadEnv();
const base = (process.argv[2] || '').replace(/\/$/, '');
if (!/^https:\/\/[^/]+\.vercel\.app$/.test(base)) { console.error('usage: live-edit.mjs https://<immutable-deployment>.vercel.app'); process.exit(2); }

let pass = 0, fail = 0;
const ok = (n, d = '') => { pass++; console.log(`  PASS  ${n}${d ? ` — ${d}` : ''}`); };
const no = (n, d = '') => { fail++; console.log(`  FAIL  ${n}${d ? ` — ${d}` : ''}`); };
const check = (c, n, d) => (c ? ok(n, d) : no(n, d));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const s = await adminSession(base);
check(s.role === 'superadmin' || s.role === 'admin', 'signed in to the deployment\'s admin', `role=${s.role}`);
const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: true } });
await db.connect();

const page = async (route) => {
  const r = await fetch(base + route, { headers: s.protect });
  return { status: r.status, cache: r.headers.get('x-vercel-cache'), html: await r.text() };
};
const warm = async (route) => {
  for (let i = 0; i < 6; i++) { const p = await page(route); if (p.cache === 'HIT') return p; await sleep(500); }
  return page(route);
};
/** Poll until `test(html)` holds; returns ms taken, or null after `limitMs`. */
let lastSeen = null;
const until = async (route, test, limitMs = 30_000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < limitMs) {
    lastSeen = await page(route);
    if (test(lastSeen.html)) return Date.now() - t0;
    await sleep(700);
  }
  return null;
};
const seen = () => lastSeen ? `last read ${lastSeen.status} x-vercel-cache=${lastSeen.cache}, prices on page: ${[...new Set([...lastSeen.html.matchAll(/data-price-cents="(\d+)"/g)].map((m) => m[1]))].join(',')}` : 'no read';
const githubDeployments = () => {
  try { return Number(execFileSync('gh', ['api', 'repos/benamtech/scoopdogg-dot-net/deployments?per_page=1', '--jq', '.[0].id'], { encoding: 'utf8' }).trim()); }
  catch { return null; }
};

const EDITS = [];

// 1. A tier price. A one-time tier, so no Stripe Price is published by the save.
{
  const { rows: [t] } = await db.query(
    `select id, label, price_cents from service_tiers where service_slug = 'pressure-washing' and status = 'active' and price_cents is not null order by sort_order limit 1`);
  const was = t.price_cents, now = was + 100;
  EDITS.push({
    name: `tier price (${t.label})`, route: '/services/pressure-washing',
    before: (h) => h.includes(`data-price-cents="${was}"`), after: (h) => h.includes(`data-price-cents="${now}"`) && !h.includes(`data-price-cents="${was}"`),
    apply: () => s.api('rate-card/tier', { method: 'PATCH', body: { id: t.id, price_cents: now } }),
    restore: () => s.api('rate-card/tier', { method: 'PATCH', body: { id: t.id, price_cents: was } }),
    shown: `$${was / 100} -> $${now / 100}`,
  });
}

// 2. A trust claim he edits on his own setup checklist.
{
  const { rows: [r] } = await db.query(`select value, updated_by from settings where key = 'trust.insured_confirmed'`);
  const was = r?.value === true;
  EDITS.push({
    name: 'trust claim (insured)', route: '/about',
    before: (h) => h.includes('Fully insured') === was, after: (h) => h.includes('Fully insured') === !was,
    apply: () => s.api('checklist/business', { method: 'PATCH', body: { key: 'trust.insured_confirmed', value: !was } }),
    restore: async () => {
      await s.api('checklist/business', { method: 'PATCH', body: { key: 'trust.insured_confirmed', value: was } });
      if (r) await db.query(`update settings set updated_by = $1 where key = 'trust.insured_confirmed'`, [r.updated_by]);
    },
    shown: `"Fully insured" ${was ? 'shown -> gone' : 'absent -> shown'}`,
  });
}

// 3 and 4 — a service's intro and an offer — join here once their editors exist (§3).
for (const extra of (await import('./_live-edit-extra.mjs').catch(() => ({ edits: [] }))).edits ?? []) EDITS.push(await extra({ s, db }));

const deploymentsBefore = githubDeployments();
try {
  // The negative control first, on the tier: a database write with no purge must not reach the page.
  {
    const e = EDITS[0];
    const p = await warm(e.route);
    check(p.cache === 'HIT' && e.before(p.html), 'the page is served from the CDN cache before any edit', `x-vercel-cache=${p.cache}`);
    const { rows: [t] } = await db.query(`select id, price_cents from service_tiers where service_slug = 'pressure-washing' and status = 'active' and price_cents is not null order by sort_order limit 1`);
    await db.query(`update service_tiers set price_cents = price_cents + 100 where id = $1`, [t.id]);
    try {
      await sleep(8000);
      const q = await page(e.route);
      check(e.before(q.html), 'NEGATIVE CONTROL (mutation: no purge): a change written with no purge does not reach the cached page', `x-vercel-cache=${q.cache}, still the old price after 8s`);
    } finally {
      await db.query(`update service_tiers set price_cents = $2 where id = $1`, [t.id, t.price_cents]);
    }
  }

  for (const e of EDITS) {
    await warm(e.route);
    const t0 = Date.now();
    try {
      await e.apply();
      const took = await until(e.route, e.after);
      check(took !== null, `${e.name}: saved in the admin, on ${e.route} with no deployment`, took !== null ? `${e.shown}, visible after ${((Date.now() - t0) / 1000).toFixed(1)}s` : `not visible after 30s; ${seen()}`);
    } finally {
      await e.restore().catch((x) => no(`${e.name}: restore`, x.message));
    }
    const back = await until(e.route, e.before);
    check(back !== null, `${e.name}: restored through the admin, and the page shows the original again`);
  }
} finally {
  await s.end();
  await db.end();
}
const deploymentsAfter = githubDeployments();
check(deploymentsBefore !== null && deploymentsBefore === deploymentsAfter, 'no new deployment was created while the edits went live', `latest GitHub deployment ${deploymentsBefore} before and ${deploymentsAfter} after; every page was read from ${new URL(base).host}`);

console.log(`\n${fail ? 'FAIL' : 'PASS'} ${pass}/${pass + fail}`);
process.exit(fail ? 1 : 0);
