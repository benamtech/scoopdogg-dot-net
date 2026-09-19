/**
 * A setting the code asks for must be one the code can actually receive.
 *
 *   node gates/settings-have-readers.mjs
 *
 * THE FAULT THIS EXISTS FOR IS NOT A MISSING READER. It is a read that compiles, names a key
 * that really is in the database, and still gets `undefined` — because two different allowlists
 * stand between a row and the code that wants it:
 *
 *   server/api  ->  loadCatalog() selects `key like '<prefix>.%'` for five prefixes
 *   src (built) ->  scripts/pull-catalog.mjs publishes an explicit PUBLIC_SETTINGS list
 *
 * On 2026-09-19 `subscription.%` was in neither, so `settings.get('subscription.pause_max_weeks')`
 * silently fell back to a literal 12 while the row said 12 — agreeing by coincidence, and about
 * to disagree the first time anybody edited it. The same shape took lane B off the built site
 * (`booking.lanes_enabled` written and never published) and left `rate_cards` read and never
 * written.
 *
 * So this gate resolves every `settings.get('…')` in the tree against the allowlist for the
 * surface that asks, and holds the unread-row debt still with a ratchet.
 */
import { readFileSync, existsSync } from 'node:fs';
import { globSync } from 'node:fs';

const CEILING = 7;   // published rows named nowhere. Lower it when you wire one; never raise it.

let pass = 0, fail = 0;
const ok = (w, d = '') => { pass++; console.log(`  PASS  ${w}${d ? ` — ${d}` : ''}`); };
const no = (w, d = '') => { fail++; console.log(`  FAIL  ${w}${d ? ` — ${d}` : ''}`); };

const read = (f) => readFileSync(f, 'utf8');
const files = (g) => globSync(g).filter((f) => !f.includes('node_modules'));

// ---- the two allowlists, read from their own source rather than retyped ------------------
const catalogDb = read('server/lib/catalog-db.ts');
const serverPrefixes = [...catalogDb.matchAll(/key like '([a-z_]+)\.%'/g)].map((m) => m[1]);
const pullCatalog = read('scripts/pull-catalog.mjs');
const publicList = pullCatalog.slice(pullCatalog.indexOf('const PUBLIC_SETTINGS'), pullCatalog.indexOf('];', pullCatalog.indexOf('const PUBLIC_SETTINGS')));
const published = [...publicList.matchAll(/'([a-z_]+\.[a-z_]+)'/g)].map((m) => m[1]);

console.log(`server prefixes: ${serverPrefixes.join(', ')}`);
console.log(`published to the built site: ${published.length} keys\n`);

ok('both allowlists were found', `${serverPrefixes.length} prefixes, ${published.length} published keys`);

// ---- every settings.get() resolves on the surface that asks for it -----------------------
const asks = [];
for (const f of [...files('server/**/*.ts'), ...files('api/**/*.ts'), ...files('src/**/*.{ts,tsx,astro}')]) {
  const body = read(f);
  // A module that fetches its own keys is not going through loadCatalog() and its filter does
  // not apply. server/lib/notify.ts does exactly that on purpose: it reads demo.mode in the
  // same query as demo.address, so a half-failed read cannot mail a real customer.
  const ownKeys = [...body.matchAll(/readSettings\(\[([^\]]*)\]/g)]
    .flatMap((m) => [...m[1].matchAll(/'([a-z_]+\.[a-z_]+)'/g)].map((k) => k[1]));
  for (const m of body.matchAll(/settings\.get\(\s*'([a-z_]+\.[a-z_]+)'/g)) {
    if (ownKeys.includes(m[1])) continue;
    asks.push({ file: f, key: m[1], server: f.startsWith('server/') || f.startsWith('api/') });
  }
}
const unreachable = asks.filter((a) => a.server
  ? !serverPrefixes.includes(a.key.split('.')[0])
  : !published.includes(a.key));

unreachable.length === 0
  ? ok('every settings.get() can actually receive its row',
      `${asks.length} reads, ${new Set(asks.map((a) => a.key)).size} distinct keys`)
  : no('every settings.get() can actually receive its row',
      unreachable.map((a) => `${a.file} asks for ${a.key} and ${a.server ? "loadCatalog()'s filter" : 'PUBLIC_SETTINGS'} does not carry it`).join('; '));

// ---- policy rows specifically: a policy nobody reads is not a policy ---------------------
const haystack = [...files('src/**/*.{ts,tsx,astro,mjs}'), ...files('server/**/*.ts'), ...files('api/**/*.ts')]
  .map(read).join('\n');
for (const k of ['subscription.pause_max_weeks', 'subscription.auto_resume_after_pause', 'booking.initial_cleanup_policy', 'visit.skip_charge_policy']) {
  haystack.includes(k)
    ? ok(`${k} has a reader`)
    : no(`${k} has a reader`, 'this row states a policy and nothing enforces it');
}

// ---- the number a customer is TOLD is the number the server ENFORCES ---------------------
const told = read('src/lib/questions.ts').includes('subscription.pause_max_weeks');
const enforced = read('server/lib/account.ts').includes("settings.get('subscription.pause_max_weeks')");
told && enforced
  ? ok('the pause ceiling a customer is told is the one the server enforces', 'one row, two readers')
  : no('the pause ceiling a customer is told is the one the server enforces',
      `question page reads the row: ${told}; pausePlan reads the row: ${enforced}`);

// ---- the debt, held still ----------------------------------------------------------------
if (existsSync('content/catalog.json')) {
  const keys = Object.keys(JSON.parse(read('content/catalog.json')).settings ?? {});
  const unread = keys.filter((k) => !haystack.includes(k));
  if (unread.length > CEILING) {
    no('published rows named nowhere did not grow',
      `${unread.length} against a ceiling of ${CEILING}: ${unread.join(', ')}`);
  } else {
    ok(unread.length < CEILING ? 'published rows named nowhere went DOWN' : 'published rows named nowhere held',
      `${unread.length}/${keys.length}${unread.length < CEILING ? ` — lower CEILING to ${unread.length}` : ''}`);
  }
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
