/**
 * A verifier's session does not move the owner's number, and a real one does.
 *
 *   node gates/funnel-source.mjs
 *
 * THE FAULT THIS EXISTS FOR, measured on 2026-09-23. `funnel_sessions` held 25 rows. All 25 were
 * AMTECH's own: four ZIPs, no names, no email addresses, and three of them written in the small
 * hours of the morning this gate was drafted, in the 93041-then-93030 pair that is
 * `gates/funnel-events.mjs`'s own fixture. The growth board reads that table for "booking-intent
 * starts" and for conversion, so the first number this client's dashboard showed about its own
 * funnel was a count of our continuous integration — and it got worse the more carefully we
 * tested. The brain already carried the vigilance version ("count both sides"). Migration 033 is
 * the mechanism and this is its negative control.
 *
 * IT IS ALSO CHANNEL ATTRIBUTION, which is why the column pays from row one instead of only
 * preventing a future error. R16 found the top of the funnel is this business's constraint — a
 * close rate near 1.0 means everyone who arrives decided somewhere else — and nothing anywhere
 * recorded where they arrived from.
 *
 * THE CONTROL IS THE POINT, and it is the shape the research note named: plant one row marked as
 * ours and fail if the board's number moves; plant one that is not ours and fail if it does not.
 * A filter that is never exercised in both directions is a filter that might be filtering
 * everything, or nothing, and a board would look calm either way.
 *
 * Everything below runs inside one transaction that is always rolled back.
 */
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { compileServer, cleanupCompile } from './_compile.mjs';
import { loadEnv } from '../scripts/_env.mjs';

loadEnv();
let pass = 0, fail = 0;
const ok = (w, d = '') => { pass++; console.log(`  PASS  ${w}${d ? ` — ${d}` : ''}`); };
const no = (w, d = '') => { fail++; console.log(`  FAIL  ${w}${d ? ` — ${d}` : ''}`); };
const check = (c, w, d = '') => (c ? ok(w, d) : no(w, d));

const MIGRATION = 'migrations/033_the_funnel_says_where_it_came_from.sql';
const funnelTs = readFileSync('server/lib/funnel.ts', 'utf8');
const growthTs = readFileSync('server/lib/growth.ts', 'utf8');
const bookingTs = readFileSync('api/booking.ts', 'utf8');

// ---- A. the reserved list has one home ---------------------------------------------------
console.log('A. one list, read by everything that filters on it');
check(/export const VERIFIER_SOURCES = \[/.test(funnelTs), 'VERIFIER_SOURCES is declared in funnel.ts');
check(/import \{ VERIFIER_SOURCES \} from '\.\/funnel\.js'/.test(growthTs)
  && /VERIFIER_SOURCES\.join/.test(growthTs),
  'growth.ts filters on that list rather than on a literal of its own',
  'a second copy of a reserved word is how the two halves drift');
check(/x-scoopdogg-verifier/.test(bookingTs) && /trusted:/.test(bookingTs),
  'the API decides `trusted` from a header, not from the request body');
const growthTsx = readFileSync('src/pages_react/admin/AdminGrowthPage.tsx', 'utf8');
check(/verifier_sessions_excluded/.test(growthTsx),
  'the Growth board says how many of our own visits it left out', 'a filter nobody can see stops being trusted');
check(/by_source/.test(growthTsx), 'and shows where visitors came from', 'the column pays for itself only if somebody can read it');
const baseAstro = readFileSync('src/layouts/Base.astro', 'utf8');
check(/sessionStorage\.setItem\('sd_src'/.test(baseAstro) && /sessionSource\(\)/.test(readFileSync('src/components/booking/BookingFlow.tsx', 'utf8')),
  'the referrer is captured on the first page and sent with the funnel', 'document.referrer survives exactly one page load');

/**
 * EVERY BROWSER THAT DRIVES THE FUNNEL MARKS ITSELF, IN ONE HEADER OBJECT.
 *
 * scripts/walk-preview.mjs set `extraHTTPHeaders` twice — the verifier marker, then the preview's
 * auth token in a spread after it — and in JavaScript the second key replaces the first. So on
 * every run that could reach a preview, the walk wrote its sessions into the client's funnel as
 * customers. Per file it looked correct: the marker was right there. This reads every file that
 * types into the booking form and checks the marker is set and never shadowed.
 */
{
  const { globSync } = await import('node:fs');
  // A funnel driver is a file that launches a browser AND enters a ZIP somewhere. Visiting /book
  // writes nothing until a ZIP exists, so a layout check that only looks at the page is not one.
  // This file is not one either: it names the selectors in a pattern and never launches a browser.
  const drivers = [...globSync('gates/*.mjs'), ...globSync('scripts/*.mjs')]
    .filter((f) => {
      const b = readFileSync(f, 'utf8');
      // Entering a ZIP is what writes a session: the booking form's field, the hero's address
      // field (which posts to /book), or a URL that arrives carrying one.
      return /chromium\.launch\(/.test(b) && /#bk-zip|input\[name=address\]|[?&]zip=/.test(b);
    });
  const unmarked = [], shadowed = [];
  for (const f of drivers) {
    const body = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ');
    if (!/x-scoopdogg-verifier/.test(body)) unmarked.push(f);
    for (const m of body.matchAll(/new(?:Page|Context)\(\{([\s\S]*?)\}\);/g)) {
      if ((m[1].match(/extraHTTPHeaders/g) ?? []).length > 1) shadowed.push(f);
    }
  }
  check(drivers.length >= 3 && unmarked.length === 0, 'every browser that fills the booking form marks itself as ours',
    unmarked.length ? unmarked.join(', ') : `${drivers.length} files: ${drivers.join(', ')}`);
  check(shadowed.length === 0, 'and none sets extraHTTPHeaders twice in one page', shadowed.length ? shadowed.join(', ') : 'the second key would replace the marker');
}

// ---- B. the normaliser, on its own ---------------------------------------------------------
console.log('\nB. a referrer becomes a host, and a reserved word needs permission');
const out = compileServer();
const mod = (f) => import(`${process.cwd()}/${out}/server/lib/${f}`.replace(`${process.cwd()}/${process.cwd()}`, process.cwd()));
const { normaliseSource, track, VERIFIER_SOURCES } = await mod('funnel.js');
const { growthBoard, unfinished } = await mod('growth.js');

const CASES = [
  ['https://www.google.com/search?q=dog+poop+ventura', 'google.com', 'a search URL keeps its host and drops the query'],
  ['https://l.instagram.com/', 'l.instagram.com', 'a subdomain is kept — it is a different channel'],
  ['nextdoor.com', 'nextdoor.com', 'a bare host passes through'],
  ['WWW.Bing.COM', 'bing.com', 'case and www. are normalised'],
  ['', null, 'an empty referrer is direct, not a channel called ""'],
  ['not a url at all!!', null, 'junk is refused rather than stored'],
  ['gate', null, 'a browser CANNOT claim to be a verifier'],
  ['gate-retro', null, 'nor the retrospective value'],
];
for (const [input, want, why] of CASES) {
  const got = normaliseSource(input);
  check(got === want, why, `${JSON.stringify(input)} -> ${JSON.stringify(got)}`);
}
check(normaliseSource('gate', { trusted: true }) === 'gate',
  'and server-side code can', 'the header path in api/booking.ts is the only caller that sets it');

// ---- C. the board, against planted rows, rolled back ---------------------------------------
console.log('\nC. the shipped board, and what a planted row does to it');
const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: true } });
await c.connect();
try {
  await c.query(`set lock_timeout = '5s'`);
  await c.query('begin');

  const hasSource = async () => (await c.query(
    `select count(*)::int n from information_schema.columns where table_name='funnel_sessions' and column_name='source'`)).rows[0].n === 1;

  if (!(await hasSource())) {
    const before = await growthBoard(c);
    check(before.attributed === false && before.verifier_sessions_excluded === null,
      'BEFORE 033 the board says it cannot tell our traffic apart',
      'which is the honest answer, and it is not the one an owner should keep getting');
    const body = readFileSync(MIGRATION, 'utf8')
      .replace(/^[ \t]*begin[ \t]*;[ \t]*$/gim, '').replace(/^[ \t]*commit[ \t]*;[ \t]*$/gim, '');
    await c.query(body);
  } else {
    ok('033 is already applied on this database');
  }
  check(await hasSource(), '033 gives the session a source', 'applied in this transaction, rolled back');

  const backfilled = (await c.query(`select count(*)::int n from funnel_sessions where source = 'gate-retro'`)).rows[0].n;
  check(backfilled >= 25, 'the rows that were already ours are labelled', `${backfilled} rows marked gate-retro`);
  const mislabelled = (await c.query(
    `select count(*)::int n from funnel_sessions where source = 'gate-retro' and (name is not null or email is not null)`)).rows[0].n;
  check(mislabelled === 0, 'and no session that reached a human name was relabelled',
    'the backfill is an inference and it is not entitled to that row');

  const base = await growthBoard(c);
  check(base.attributed === true, 'the board now knows it can tell', `excluded so far this month: ${base.verifier_sessions_excluded}`);
  const startsBefore = base.metrics.booking_intent_starts.value;

  // ---- the control: OUR row ----------------------------------------------------------------
  const gateId = crypto.randomUUID();
  await track({ session_id: gateId, step: 'price', postal_code: '93030', price_cents_seen: 12000, source: 'gate', trusted: true }, c);
  const gateRow = (await c.query(`select source from funnel_sessions where id = $1`, [gateId])).rows[0];
  check(gateRow?.source === 'gate', 'a verifier session is written and marked', `source=${gateRow?.source}`);

  const afterGate = await growthBoard(c);
  check(afterGate.metrics.booking_intent_starts.value === startsBefore,
    'and the owner’s booking-intent count DOES NOT MOVE',
    `${startsBefore} -> ${afterGate.metrics.booking_intent_starts.value}`);
  check(afterGate.verifier_sessions_excluded === base.verifier_sessions_excluded + 1,
    'it is counted where it belongs, as one of ours',
    `${base.verifier_sessions_excluded} -> ${afterGate.verifier_sessions_excluded} excluded`);

  const unfGate = await unfinished(60, c);
  check(!unfGate.rows.some((r) => r.id === gateId),
    'and it never reaches the speed-to-lead block',
    'Josue texting a gate run is the version of this fault he would actually notice');

  // ---- the other direction: a REAL row -----------------------------------------------------
  const realId = crypto.randomUUID();
  await track({ session_id: realId, step: 'price', postal_code: '93030', price_cents_seen: 12000, source: 'https://www.nextdoor.com/feed/' }, c);
  const realRow = (await c.query(`select source from funnel_sessions where id = $1`, [realId])).rows[0];
  check(realRow?.source === 'nextdoor.com', 'a real session keeps the host it came from', `source=${realRow?.source}`);

  const afterReal = await growthBoard(c);
  check(afterReal.metrics.booking_intent_starts.value === startsBefore + 1,
    'and THAT one does move the number — so the filter is not filtering everything',
    `${startsBefore} -> ${afterReal.metrics.booking_intent_starts.value}`);
  const nd = afterReal.by_source.find((r) => r.source === 'nextdoor.com');
  check(!!nd && nd.sessions === 1 && nd.priced === 1,
    'the channel breakdown names it', nd ? `nextdoor.com: ${nd.sessions} session, ${nd.priced} priced` : 'not in by_source');
  check(!afterReal.by_source.some((r) => VERIFIER_SOURCES.includes(r.source)),
    'and the breakdown never shows one of ours as a channel');

  // ---- the browser cannot mark itself -------------------------------------------------------
  console.log('\nnegative controls');
  const liarId = crypto.randomUUID();
  await track({ session_id: liarId, step: 'price', postal_code: '93030', source: 'gate' }, c);
  const liar = (await c.query(`select source from funnel_sessions where id = $1`, [liarId])).rows[0];
  check(liar?.source === null, 'an untrusted caller sending source=gate is recorded as direct, not hidden',
    `source=${JSON.stringify(liar?.source)}`);
  const afterLiar = await growthBoard(c);
  check(afterLiar.metrics.booking_intent_starts.value === startsBefore + 2,
    'and it counts, because it is somebody', `${afterLiar.metrics.booking_intent_starts.value}`);

  // The first step decides the channel: a later call from the site's own page must not overwrite it.
  await track({ session_id: realId, step: 'lane', lane: 'prepay', source: 'scoopdogg.net' }, c);
  const stillNd = (await c.query(`select source from funnel_sessions where id = $1`, [realId])).rows[0];
  check(stillNd?.source === 'nextdoor.com', 'a later step does not overwrite where they came from',
    'otherwise every channel becomes direct on the second click');

  // The constraint is real, not decorative.
  let rejected = false;
  try { await c.query(`savepoint s1`);
    await c.query(`insert into funnel_sessions (id, source) values ($1, 'NOT A HOST')`, [crypto.randomUUID()]);
  } catch { rejected = true; } finally { await c.query(`rollback to savepoint s1`).catch(() => {}); }
  check(rejected, 'the column refuses a value that is not a hostname or a reserved word',
    'a free-text column is one nobody can group by');
} catch (e) {
  no('the gate ran to the end', String(e.message ?? e));
} finally {
  await c.query('rollback').catch(() => {});
  await c.end().catch(() => {});
  cleanupCompile();
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
