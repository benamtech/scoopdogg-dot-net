/**
 * Put the Stripe keys the deployed functions need onto the Vercel project.
 *
 *   node scripts/push-stripe-env.mjs            # report what is there and what is missing
 *   node scripts/push-stripe-env.mjs --apply    # add whatever is missing
 *
 * WHY IT EXISTS. `server/lib/stripe.ts` reads STRIPE_SECRET_KEY_TEST and STRIPE_SECRET_KEY_LIVE.
 * Locally `scripts/_env.mjs` maps them from the brain's sealed `.env`, so every gate and script
 * works. A DEPLOYED function has only the Vercel project's own variables, and measured
 * 2026-09-19 the project had the test key on development and preview and no live key at all - so
 * the Connect button throws `stripe_key_missing_live` on any deployment.
 *
 * RULE 12, AND HOW THIS KEEPS IT. The value goes from the brain's .env into this process's memory
 * and out through the child's STDIN. It is never printed, never written to a file, never put on a
 * command line and never returned. The receipt is the key's prefix and its length.
 */
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';

const apply = process.argv.includes('--apply');
const SCOPE = 'benamtechs-projects';

/** Read one key out of the brain's sealed .env without it passing through anything else. */
function fromBrainEnv(name) {
  const p = new URL('../../../.env', import.meta.url).pathname;
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const i = line.indexOf('=');
    if (i > 0 && line.slice(0, i).trim() === name) return line.slice(i + 1).trim().replace(/^["']|["']$/g, '');
  }
  return null;
}

const run = (args, stdin) => new Promise((resolve) => {
  const p = spawn('npx', ['vercel', ...args, '--scope', SCOPE], { stdio: ['pipe', 'pipe', 'pipe'] });
  let out = '', err = '';
  p.stdout.on('data', (d) => { out += d; });
  p.stderr.on('data', (d) => { err += d; });
  if (stdin !== undefined) { p.stdin.write(stdin); }
  p.stdin.end();
  p.on('close', (code) => resolve({ code, out, err }));
});

// What the project has now. `vercel env ls` prints NAMES and targets, never values.
const listed = await run(['env', 'ls']);
const have = new Set();
for (const line of (listed.out + listed.err).split('\n')) {
  const m = /^\s*(STRIPE_SECRET_KEY\w*)\s+(\w+)/.exec(line);
  if (m) have.add(`${m[1]}:${m[2]}`);
  else {
    const m2 = /^\s*(STRIPE_SECRET_KEY\w*)\s/.exec(line);
    if (m2) have.add(`${m2[1]}:?`);
  }
}
console.log(`  on the project: ${[...have].sort().join(', ') || '(none matched)'}`);

const WANT = [
  ['STRIPE_SECRET_KEY_TEST', 'AMTECH_STRIPE_TEST_KEY', ['production'], 'sk_test_'],
  ['STRIPE_SECRET_KEY_LIVE', 'AMTECH_STRIPE_LIVE_KEY', ['production', 'preview', 'development'], 'sk_live_'],
];

let added = 0, skipped = 0;
for (const [name, brainName, targets, prefix] of WANT) {
  const value = fromBrainEnv(brainName);
  if (!value) { console.log(`  MISSING in the brain .env: ${brainName} — nothing to push for ${name}`); continue; }
  if (!value.startsWith(prefix) && !value.startsWith(prefix.replace('sk_', 'rk_'))) {
    console.log(`  REFUSING ${name}: the brain's ${brainName} is not a ${prefix}… key`);
    continue;
  }
  console.log(`  ${name}: present in the brain, ${value.length} chars, ${value.slice(0, 8)}…`);
  for (const target of targets) {
    if (have.has(`${name}:${target}`)) { console.log(`    ${target}: already set`); skipped++; continue; }
    if (!apply) { console.log(`    ${target}: WOULD ADD`); continue; }
    // The value reaches Vercel through the child's stdin and nowhere else.
    const r = await run(['env', 'add', name, target], `${value}\n`);
    const ok = r.code === 0 || /already exists/i.test(r.err);
    console.log(`    ${target}: ${ok ? 'added' : `FAILED — ${(r.err || '').split('\n').find((l) => l.trim()) ?? r.code}`}`);
    if (ok) added++;
  }
}

console.log(`\n  ${apply ? `${added} added, ${skipped} already present` : 'dry run — re-run with --apply'}`);
console.log('  A deployment must be rebuilt to pick up a new variable.');
