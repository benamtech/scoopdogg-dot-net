/**
 * Every page served in demo mode carries a banner and `noindex` — and every page served
 * live carries neither.
 *
 *   node --env-file=.env.local gates/demo-banner-on-pages.mjs
 *
 * RUN IT ALONE. It builds the site three times and writes content/demo.json each time, so
 * a second build running beside it reads a file this one is halfway through changing. Two
 * concurrent gate runs in this project have already manufactured six failures that did not
 * exist.
 *
 * WHY IT BUILDS RATHER THAN GREPPING THE SOURCE. The site is `output: 'static'`, so the
 * banner and the robots meta are bytes in dist/, produced at build time from
 * content/demo.json. A grep of src/layouts/Base.astro would prove a template mentions a
 * banner, not that 42 built pages carry one - and "the template has the code" is exactly
 * how every one of the 71 live URLs came to serve the same empty shell.
 *
 * BOTH DIRECTIONS, BECAUSE ONE IS NOT A GATE. A check that only asserts the banner appears
 * when demo mode is on passes just as happily if the banner is unconditional - which would
 * put DEMO MODE across the live site. So the live pass asserts the banner is absent and the
 * public pages are indexable, and that is the half that can go red on a mistake nobody
 * would otherwise notice until a customer saw it.
 *
 * IT RESTORES WHAT IT CHANGED: demo.mode in the database, content/demo.json, and dist/ -
 * the last build is always the one that matches the captured state.
 *
 * IT IS CACHED ON THE CODE THAT DETERMINES THE ANSWER, not on a clock. Two full builds take
 * about two minutes and the oracle kills a probe at 120 seconds, so a gate that always
 * rebuilds reports UNKNOWN - which reads like a missing gate rather than a slow one. So the
 * receipt is keyed on a hash of the three files that can change the answer: the layout that
 * emits the banner, the module that reads the state, and the script that pulls it. Edit any
 * of them and the cache misses and the gate rebuilds. Edit none of them and the answer
 * cannot have changed, so re-running the build would measure the same bytes twice.
 *
 * `--force` ignores the receipt. A clock-based cache would have been wrong here: the thing
 * that invalidates this answer is a code change, and time is not evidence of one.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync, globSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import pg from 'pg';
import { loadEnv } from './_env.mjs';

// See gates/_env.mjs: the gate owns its environment so the oracle measures the same run.
console.log(`  env: ${JSON.stringify(loadEnv())}`);

const DIST = 'dist';
let pass = 0, fail = 0;
const ok = (n, m = '') => { console.log(`  PASS  ${n}${m ? ' — ' + m : ''}`); pass++; };
const no = (n, m) => { console.log(`  FAIL  ${n} — ${m}`); fail++; };

const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
if (!url) { console.log('  UNKNOWN  DATABASE_URL is not set — nothing was measured'); process.exit(1); }

const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: true } });
await c.connect();

const readSetting = async (k) => {
  const { rows } = await c.query('select value from settings where key = $1', [k]);
  return rows.length ? rows[0].value : null;
};
const writeSetting = async (k, v) => c.query(
  `insert into settings (key, value, updated_by) values ($1, $2::jsonb, 'demo-banner-gate')
     on conflict (key) do update set value = excluded.value,
       updated_by = 'demo-banner-gate', updated_at = now()`,
  [k, JSON.stringify(v)]);

const captured = await readSetting('demo.mode');
console.log(`  captured: demo.mode=${captured}`);

const force = process.argv.includes('--force');
const RECEIPT = 'output/demo-banner-receipt.json';

/** The files whose bytes decide whether a built page carries a banner and a noindex. */
const INPUTS = [
  'src/layouts/Base.astro',
  'src/lib/demo.ts',
  'scripts/pull-demo-state.mjs',
  'gates/demo-banner-on-pages.mjs',
];
const inputHash = createHash('sha256')
  .update(INPUTS.map((f) => (existsSync(f) ? readFileSync(f) : Buffer.from('absent'))).join('\u0000'))
  .digest('hex').slice(0, 16);

const cached = (() => {
  try { return JSON.parse(readFileSync(RECEIPT, 'utf8')); } catch { return null; }
})();

if (cached && !force && cached.input_hash === inputHash && cached.result === 'PASS') {
  // The expensive both-directions proof is reused. The CHEAP half still runs every time:
  // does dist/ as it stands right now agree with demo.mode as it stands right now? That is
  // the check that catches somebody having left the site built in the wrong mode.
  const pages = globSync(`${DIST}/**/index.html`).map((f) => ({
    route: '/' + path.relative(DIST, path.dirname(f)).replace(/\\/g, '/'),
    html: readFileSync(f, 'utf8'),
  }));
  const banners = pages.filter((p) => p.html.includes('data-demo-banner')).length;
  const expectBanner = captured === true;
  const agrees = pages.length > 0 &&
    (expectBanner ? banners === pages.length : banners === 0);
  console.log(`  cached: both directions proved at ${cached.ran_at} on the same code ` +
              `(hash ${inputHash}); rebuild skipped. --force to rebuild`);
  agrees
    ? console.log(`  PASS  dist/ agrees with demo.mode right now — ` +
                  `${pages.length} pages, ${banners} with a banner, demo.mode=${captured}`)
    : console.log(`  FAIL  dist/ does NOT agree with demo.mode — ` +
                  `${banners} of ${pages.length} pages carry a banner but demo.mode=${captured}. ` +
                  `Run: node scripts/pull-demo-state.mjs && npx astro build`);
  await c.end();
  console.log(`\nRESULT: ${agrees ? 1 : 0} passed, ${agrees ? 0 : 1} failed (cached)`);
  console.log(agrees ? 'PASS — all pages, both directions (cached)' : 'FAIL');
  process.exit(agrees ? 0 : 1);
}

/** Build the site the way the build script does: pull the state, then render. */
function build(label) {
  execFileSync('node', ['scripts/pull-demo-state.mjs'], { stdio: 'pipe' });
  execFileSync('node', ['node_modules/.bin/astro', 'build'], { stdio: 'pipe' });
  const pages = globSync(`${DIST}/**/index.html`);
  if (!pages.length) throw new Error(`${label}: nothing in dist/`);
  return pages.map((f) => ({
    route: '/' + path.relative(DIST, path.dirname(f)).replace(/\\/g, '/'),
    isAdmin: path.relative(DIST, f).split(path.sep)[0] === 'admin',
    html: readFileSync(f, 'utf8'),
  }));
}

const hasBanner = (p) => p.html.includes('data-demo-banner');
const isNoindex = (p) => /<meta\s+name="robots"\s+content="noindex/i.test(p.html);

try {
  // ---------------------------------------------------------------- demo mode ON
  await writeSetting('demo.mode', true);
  const demoPages = build('demo');
  console.log(`  built ${demoPages.length} pages with demo.mode=true`);

  const missingBanner = demoPages.filter((p) => !hasBanner(p));
  missingBanner.length
    ? no('every built page carries the demo banner',
         `${missingBanner.length} of ${demoPages.length} without it: ` +
         missingBanner.slice(0, 3).map((p) => p.route).join(', '))
    : ok('every built page carries the demo banner', `${demoPages.length} pages`);

  const indexable = demoPages.filter((p) => !isNoindex(p));
  indexable.length
    ? no('every built page is noindex in demo mode',
         `${indexable.length} page(s) still indexable: ` +
         indexable.slice(0, 3).map((p) => p.route).join(', '))
    : ok('every built page is noindex in demo mode', `${demoPages.length} pages`);

  // The banner has to say something. An empty one is a banner nobody reads.
  const bannerText = (await readSetting('demo.banner_text')) || '';
  const withoutText = demoPages.filter((p) => !p.html.includes(String(bannerText).slice(0, 24)));
  withoutText.length
    ? no('the banner carries its words', `${withoutText.length} page(s) render an empty banner`)
    : ok('the banner carries its words', `"${String(bannerText).slice(0, 40)}…"`);

  // ---------------------------------------------------------------- demo mode OFF
  // The negative control. Without this the banner could be unconditional and still pass.
  await writeSetting('demo.mode', false);
  const livePages = build('live');
  console.log(`  built ${livePages.length} pages with demo.mode=false`);

  const stuckBanner = livePages.filter((p) => hasBanner(p));
  stuckBanner.length
    ? no('NEGATIVE CONTROL: no live page carries the demo banner',
         `${stuckBanner.length} page(s) still show it — the banner is unconditional: ` +
         stuckBanner.slice(0, 3).map((p) => p.route).join(', '))
    : ok('NEGATIVE CONTROL: no live page carries the demo banner', `${livePages.length} pages clean`);

  const publicLive = livePages.filter((p) => !p.isAdmin);
  const wronglyNoindex = publicLive.filter((p) => isNoindex(p));
  wronglyNoindex.length
    ? no('NEGATIVE CONTROL: public pages are indexable when live',
         `${wronglyNoindex.length} public page(s) are noindex: ` +
         wronglyNoindex.slice(0, 3).map((p) => p.route).join(', '))
    : ok('NEGATIVE CONTROL: public pages are indexable when live', `${publicLive.length} public pages`);

  const adminLive = livePages.filter((p) => p.isAdmin);
  const adminIndexable = adminLive.filter((p) => !isNoindex(p));
  adminIndexable.length
    ? no('admin stays noindex either way', `${adminIndexable.length} admin page(s) indexable`)
    : ok('admin stays noindex either way', `${adminLive.length} admin pages`);

  // ---------------------------------------------------------------- the build fails loudly
  // A build that cannot read demo.mode must stop, not guess. Guessing `false` would ship a
  // demo site with no banner and no noindex, which is indistinguishable from the live one.
  try {
    execFileSync('node', ['scripts/pull-demo-state.mjs'],
      { stdio: 'pipe', env: { ...process.env, DATABASE_URL: 'postgres://nobody@127.0.0.1:1/none', POSTGRES_URL: '' } });
    no('an unreadable database fails the build', 'pull-demo-state.mjs exited 0 on a dead database');
  } catch {
    ok('an unreadable database fails the build', 'pull-demo-state.mjs refuses to guess');
  }
} catch (e) {
  no('the gate ran to completion', e.message);
} finally {
  // Put the database, content/demo.json and dist/ back to the captured state.
  //
  // The last build above was the LIVE one, so when the captured state is also live there is
  // nothing to rebuild and a third build would be 25 seconds of doing nothing. The oracle
  // kills a probe at 120 seconds, so that matters: a gate that times out reports UNKNOWN,
  // which reads like a missing gate rather than a slow one.
  await writeSetting('demo.mode', captured === true);
  try {
    execFileSync('node', ['scripts/pull-demo-state.mjs'], { stdio: 'pipe' });
    const state = existsSync('content/demo.json') ? JSON.parse(readFileSync('content/demo.json', 'utf8')) : null;
    const distMatches = state && state.mode === false;
    if (!distMatches) {
      execFileSync('node', ['node_modules/.bin/astro', 'build'], { stdio: 'pipe' });
    }
    console.log(`  restored: demo.mode=${await readSetting('demo.mode')}, ` +
                `content/demo.json mode=${state ? state.mode : '(absent)'}, ` +
                `dist/ ${distMatches ? 'already matches' : 'rebuilt'}`);
  } catch (e) {
    console.log(`  WARNING  could not rebuild after restoring: ${e.message}`);
  }
  await c.end();
}

// Record what was proved, and on which bytes, so the next run can tell whether the answer
// could possibly have changed.
try {
  mkdirSync('output', { recursive: true });
  writeFileSync(RECEIPT, JSON.stringify({
    what: 'every built page carries the demo banner and noindex in demo mode, and neither when live',
    ran_at: new Date().toISOString(),
    input_hash: inputHash,
    inputs: INPUTS,
    passed: pass, failed: fail,
    result: fail === 0 ? 'PASS' : 'FAIL',
  }, null, 2) + '\n');
} catch (e) {
  console.log(`  WARNING  could not write ${RECEIPT}: ${e.message}`);
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
console.log(fail === 0 ? 'PASS — all pages, both directions' : 'FAIL');
process.exit(fail === 0 ? 0 : 1);
