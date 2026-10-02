/**
 * The gates below read `dist/`. This one refuses to let them read an old one.
 *
 *   node gates/dist-is-fresh.mjs
 *
 * `npm run gates` does not build — `npm run build` does, and runs build-gates itself. So the suite
 * reads whatever build is on disk. Measured 2026-09-23: two full runs reported green on a `dist/`
 * that predated the Team screen, and `orphan-pages` could not see that `/admin/team` was missing
 * from its private list. The first fresh build turned it red.
 *
 * So: if any source file is newer than the build, stop and say which, before any gate reads it.
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const BUILT = 'dist/index.html';
if (!existsSync(BUILT)) { console.log('  FAIL  there is no build — run `npm run build` first'); process.exit(1); }
const builtAt = statSync(BUILT).mtimeMs;

const walk = (d) => (existsSync(d)
  ? readdirSync(d).flatMap((f) => { const p = path.join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; })
  : []);
// content/*.json is written BY the build, before astro runs, so it is older than dist by design.
const newer = ['src', 'public', 'astro.config.mjs', 'tailwind.config.js']
  .flatMap((p) => (existsSync(p) && statSync(p).isDirectory() ? walk(p) : existsSync(p) ? [p] : []))
  .filter((f) => statSync(f).mtimeMs > builtAt);

if (newer.length) {
  console.log(`  FAIL  dist/ is older than ${newer.length} source file(s) — run \`npm run build\`, then the gates`);
  for (const f of newer.slice(0, 5)) console.log(`        ${f}`);
  process.exit(1);
}
console.log(`  PASS  dist/ is newer than every source file — built ${new Date(builtAt).toISOString()}`);
console.log('PASS 1/1');
