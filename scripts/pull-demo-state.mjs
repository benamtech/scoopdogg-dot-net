/**
 * Read `demo.mode` out of the database and write it to content/demo.json, as build step one.
 *
 *   node --env-file=.env.local scripts/pull-demo-state.mjs
 *
 * WHY A BUILD STEP AND NOT A RUNTIME READ. The site is `output: 'static'` on purpose - every
 * one of the 71 URLs on the live site serves the same empty shell today because a bolted-on
 * prerenderer was skipped in production, and static output makes real HTML per route the
 * default instead of a step that can be turned off. Static also means there is no server
 * rendering the page when a crawler asks for it, so `noindex` and the demo banner have to be
 * IN the bytes. A script that injected the banner after the page loaded would be invisible
 * to the crawler and to any gate that reads the built HTML.
 *
 * So the demo banner is part of what gets published. Turning demo mode on or off is a
 * setting change plus a publish - the same shape as changing a price, which is what the
 * publish path exists for.
 *
 * IT FAILS RATHER THAN GUESSING. If DATABASE_URL is set and the read does not work, this
 * exits non-zero and the build stops. The alternative - substituting `false` - would ship a
 * demo site with no banner and no noindex, and whoever opened the tab next would have no way
 * to tell it from the live one. A reader that fails says so.
 *
 * With no DATABASE_URL at all it leaves content/demo.json exactly as it is on disk and says
 * so loudly, because that is a local build with no database, not a lie about the state.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';

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
const mode = map.get('demo.mode') === true;
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
