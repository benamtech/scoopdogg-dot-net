/**
 * Compile api/ and server/ so a gate can call the REAL functions.
 *
 * Why this exists rather than a gate importing the TypeScript directly: `api/` and
 * `server/` use ESM-correct imports (`./db.js` naming `db.ts`), which is what Vercel's
 * Node builder resolves. Node's own type-stripping does not do that rewrite, so
 * `import('server/lib/notify.ts')` fails on the first relative import.
 *
 * The alternative was for each gate to re-implement what sendEmail does. That is the one
 * thing a gate must never do - it would then pass whenever the copy was right and the
 * shipped code was wrong, which is exactly the failure these gates exist to catch.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync, existsSync, readdirSync } from 'node:fs';

// Every TypeScript file in a directory, so a new server module is compiled without anyone
// remembering to add it here (the first version named six files and silently missed the rest).
const listTs = (dir) => readdirSync(dir).filter((f) => f.endsWith('.ts')).map((f) => `${dir}/${f}`);
import path from 'node:path';

export const GATE_BUILD = '.gate-build';

/**
 * WHY `dir` EXISTS. `cleanupCompile()` deletes the build directory when a gate finishes, and
 * `scripts/dev-server.mjs` imports its API handlers from that same directory for as long as it
 * runs. So running any gate that compiles — consent, invite-flow, price-four-places — pulled the
 * routes out from under a dev server that was already serving, and every subsequent request to
 * /api/* answered 404. The site looked broken; nothing about the site was broken.
 *
 * Measured 2026-09-19: `gates/funnel-events.mjs` failed on its first `waitFor` with the funnel
 * rendering perfectly and `/api/booking/zip` returning 404. Twenty minutes to find, because the
 * symptom is in the browser and the cause is a directory.
 *
 * The dev server passes its own directory. Gates keep the default and keep deleting it.
 */
export function compileServer({ quiet = true, dir = GATE_BUILD } = {}) {
  const GATE_BUILD = dir;
  rmSync(GATE_BUILD, { recursive: true, force: true });
  mkdirSync(GATE_BUILD, { recursive: true });
  // The repo is "type": "module", but .gate-build is outside the package root's reach for
  // some resolvers, so state it here too. Emitting CJS by accident is a silent failure.
  writeFileSync(path.join(GATE_BUILD, 'package.json'), JSON.stringify({ type: 'module' }) + '\n');

  // `pg` ships no types, so tsc reports TS7016 and exits non-zero while still emitting
  // perfectly good JavaScript. What matters is whether the module we are about to import
  // exists, so that - and not the exit code - is the check. Typechecking is a separate
  // concern from "can this gate call the real function", and conflating them would make a
  // missing @types package look like a demo-mode failure.
  let tscOutput = '';
  try {
    execFileSync('npx', [
      'tsc', '--ignoreConfig',
      '--outDir', GATE_BUILD, '--rootDir', '.',
      '--target', 'es2022', '--module', 'nodenext', '--moduleResolution', 'nodenext',
      '--skipLibCheck', '--resolveJsonModule',
      // src/shared is imported three ways and each resolver wants something different: Node's
      // own type-stripper (`node --test tests/*.test.ts`) resolves the literal specifier and
      // will not rewrite `.js` to `.ts`; `--module nodenext` will not accept a bare specifier.
      // So the SOURCE says `./pricing.ts` — which Node and Vite both resolve — and tsc rewrites
      // it to `.js` on the way out. Without these two flags, adding the second shared module
      // made `npm test` and this compile mutually exclusive.
      '--allowImportingTsExtensions', '--rewriteRelativeImportExtensions',
      // src/shared is listed as a DIRECTORY for the same reason api/ and server/lib are: this
      // line named pricing.ts alone until 2026-09-19, so consent.ts - which the server imports
      // and a gate has to call - would have been missing with no error anyone would connect.
      ...listTs('api'), ...listTs('server/lib'), ...listTs('src/shared'),
    ], { stdio: quiet ? 'pipe' : 'inherit', encoding: 'utf8' });
  } catch (e) {
    tscOutput = String(e.stdout || '') + String(e.stderr || '');
  }

  // ONE PROBE PER TREE. This checked `server/lib/notify.js` alone, so a compile that emitted
  // server/ and no api/ was reported as a success — which is exactly the shape of the failure
  // above, seen from the other side.
  for (const probe of [
    path.join(GATE_BUILD, 'server', 'lib', 'notify.js'),
    path.join(GATE_BUILD, 'api', 'booking.js'),
    path.join(GATE_BUILD, 'src', 'shared', 'pricing.js'),
  ]) {
    if (!existsSync(probe)) {
      throw new Error(`tsc produced no ${probe}\n${tscOutput.split('\n').slice(0, 8).join('\n')}`);
    }
  }

  return path.resolve(GATE_BUILD);
}

export function cleanupCompile(dir = GATE_BUILD) {
  rmSync(dir, { recursive: true, force: true });
}
