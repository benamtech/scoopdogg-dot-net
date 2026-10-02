/**
 * Read `demo.mode` out of the database and write it to content/demo.json — FOR THE GATES ONLY.
 *
 *   node scripts/pull-demo-state.mjs
 *
 * NO PAGE READS THIS FILE (2026-09-29). Each render reads `demo.mode` with the catalog
 * (server/lib/public-catalog.ts), so the banner and the `noindex` are in the HTML a crawler
 * receives, and turning demo mode on or off reaches every page as soon as the save purges the
 * page cache. This file is the gates' independent statement of what the rows said at build, which
 * gates/demo-banner-on-pages.mjs compares with the rendered pages.
 *
 * IT FAILS RATHER THAN GUESSING. If DATABASE_URL is set and the read does not work, this exits
 * non-zero. With no DATABASE_URL at all it leaves content/demo.json as it is and says so.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { loadEnv } from './_env.mjs';
// The environment is this script's own dependency. `--env-file=.env.local` still works and
// is still the documented way for a human; a bare `node scripts/<this>` now works too, which
// is the only shape an agent session can run (scripts/_env.mjs says why). Nothing is printed.
loadEnv();


const OUT = path.resolve('content/demo.json');
const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;

const onDisk = () => {
  try { return JSON.parse(readFileSync(OUT, 'utf8')); } catch { return null; }
};

if (!url) {
  const current = onDisk();
  if (!current) {
    // Nothing on disk and no database: write the live default. `mode: false` is the safe
    // direction - a live-looking page is never mistaken for a demo, only the reverse hurts.
    writeFileSync(OUT, JSON.stringify(
      { mode: false, banner_text: '', source: 'default', pulled_at: null }, null, 2) + '\n');
    console.log('[demo] no DATABASE_URL and no content/demo.json — wrote the live default');
  } else {
    console.log(`[demo] no DATABASE_URL — keeping content/demo.json as it is (mode: ${current.mode})`);
  }
  process.exit(0);
}

const host = (() => { try { return new URL(url).host.split('.').slice(-3).join('.'); } catch { return 'unknown'; } })();
const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: true } });

let rows;
try {
  await c.connect();
  ({ rows } = await c.query(
    `select key, value from settings where key in ('demo.mode', 'demo.banner_text')`));
} catch (e) {
  console.error(`[demo] FAILED to read demo.mode from …${host}: ${e.message}`);
  console.error('[demo] refusing to guess. A demo build with no banner is indistinguishable ' +
                'from the live site, so the build stops here.');
  try { await c.end(); } catch { /* already down */ }
  process.exit(1);
}
await c.end();

const map = new Map(rows.map((r) => [r.key, r.value]));
// A Vercel Preview environment forces demo mode (SD_FORCE_DEMO=1) so a preview can never take a
// live payment or mail a real inbox - and it must SAY so on every page, like any demo build.
const mode = process.env.SD_FORCE_DEMO === '1' || map.get('demo.mode') === true;
const banner = typeof map.get('demo.banner_text') === 'string' ? map.get('demo.banner_text') : '';

if (mode && !banner) {
  console.error('[demo] demo.mode is ON and demo.banner_text is empty. A mode you cannot see ' +
                'from the screen is a mode that ships. Set demo.banner_text and rebuild.');
  process.exit(1);
}

const state = { mode, banner_text: banner, source: `db:…${host}`, pulled_at: new Date().toISOString() };
const before = onDisk();
writeFileSync(OUT, JSON.stringify(state, null, 2) + '\n');
console.log(`[demo] content/demo.json  was: ${before ? before.mode : '(absent)'}  now: ${mode}`);
