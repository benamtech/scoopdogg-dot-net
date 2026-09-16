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

export function compileServer({ quiet = true } = {}) {
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
      ...listTs('api'), ...listTs('server/lib'), 'src/shared/pricing.ts',
    ], { stdio: quiet ? 'pipe' : 'inherit', encoding: 'utf8' });
  } catch (e) {
    tscOutput = String(e.stdout || '') + String(e.stderr || '');
  }

  const probe = path.join(GATE_BUILD, 'server', 'lib', 'notify.js');
  if (!existsSync(probe)) {
    throw new Error(`tsc produced no ${probe}\n${tscOutput.split('\n').slice(0, 8).join('\n')}`);
  }

  return path.resolve(GATE_BUILD);
}

export function cleanupCompile() {
  rmSync(GATE_BUILD, { recursive: true, force: true });
}
