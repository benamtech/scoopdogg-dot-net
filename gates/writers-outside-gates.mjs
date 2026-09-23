/**
 * A table only the gates write is a feature that has never run.
 *
 *   node gates/writers-outside-gates.mjs
 *
 * THE DEFECT CLASS, and it is the third instance on this project rather than an incident:
 *
 *   2026-09   gates/lead-comms.mjs inserted its own completed visits. The review request R8
 *             called the single highest-return growth item could never fire in production.
 *   R14 §B    gates/price-clears-the-floor.mjs checks the ladder against `est_minutes`, the
 *             column the ladder was derived from. Input and standard are one number.
 *   2026-09-23 gates/lead-comms.mjs AGAIN — it inserts its own `payment_methods` row, so the
 *             card-expiry warning has never been able to fire. `payment_methods`: 0 rows.
 *
 * The third was found by asking a question nobody had asked: the first fix checked the visits
 * half of that gate and stopped. The same file did it twice.
 *
 * WHY THIS CANNOT BE A BETTER GATE SOMEWHERE ELSE. Per file, every one of those gates is
 * correct — it plants a row, exercises the shipped query, and rolls back. The defect only exists
 * ACROSS files: the planting is the only writer in the repository. No per-gate check can see
 * that, which is why this one reads the whole tree and nothing else does.
 *
 * THE RULE
 *
 *   If `gates/` writes rows into table X, something outside `gates/` and outside `migrations/`
 *   must write X too — or the feature reading X has never run on real data.
 *
 * Migrations are excluded on purpose: seed data is a real writer for a reference table and
 * would mask the fault on every table the seed touches. Deletes do not count as writers
 * (scripts/demo-clear.mjs deletes from tables nothing fills), and neither do the two columns a
 * table gets from its own DEFAULT.
 *
 * COLUMNS TOO, because the 2026-09 instance was a column and not a table. `visits` had inserts
 * all over booking.ts; what no shipped code wrote was `completed_at`. A table-level rule alone
 * would have passed that day.
 *
 * WHAT IT DOES NOT CLAIM. A writer existing is not a writer running — a path can be dead for
 * other reasons, and gates/lead-comms.mjs check A is what pins a sender to a trigger. This gate
 * answers the narrower question that had no reader at all: does anything but us ever write this.
 */
import { readFileSync, globSync } from 'node:fs';

let pass = 0, fail = 0;
const ok = (w, d = '') => { pass++; console.log(`  PASS  ${w}${d ? ` — ${d}` : ''}`); };
const no = (w, d = '') => { fail++; console.log(`  FAIL  ${w}${d ? ` — ${d}` : ''}`); };

const read = (f) => readFileSync(f, 'utf8');
const files = (g) => globSync(g).filter((f) => !f.includes('node_modules') && !f.includes('/dist/'));

/**
 * Tables that are DECLARED to have no writer but us, each with the reason and the thing that
 * would retire the entry. An empty list is the goal; an entry here is a debt with a name on it,
 * and `--strict` ignores the list entirely so the real number is always one command away.
 */
const ACCEPTED = new Map([
  // A team member is created by a migration and by nothing else: there is no "add somebody" screen
  // in the admin, and `api/admin.ts` only LISTS `team_members`. gates/admin-roles.mjs plants one
  // because it has to have somebody to refuse. Retire this entry the day the admin can add a
  // person — and note `admin-auth.ts` already documents revoking as "one UPDATE on
  // team_members.status", which nothing performs either.
  ['team_members.name', 'no screen creates a team member; migration 018 seeds them'],
  ['team_members.email', 'no screen creates a team member; migration 018 seeds them'],
  ['team_members.phone', 'no screen creates a team member; migration 018 seeds them'],
  ['team_members.started_at', 'no screen creates a team member; migration 018 seeds them'],
  // gates/consent.mjs sets `promo_months = 2` inside a rolled-back transaction to prove the
  // renewal-consent guard REJECTS a multi-month promo. The row is the subject of that test, not a
  // stand-in for a missing writer: an offer is defined by a migration on this project, and when an
  // offer editor exists this entry goes.
  ['offers.promo_months', 'set only to prove the consent guard rejects it; offers are defined by migration'],
]);
const strict = process.argv.includes('--strict');

// ---- the tables, read from the migrations rather than from a list in here -----------------
const schema = files('migrations/*.sql').sort().map(read).join('\n');
const tables = new Set([...schema.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?([a-z_][a-z0-9_]*)/gi)].map((m) => m[1].toLowerCase()));
for (const m of schema.matchAll(/drop\s+table\s+(?:if\s+exists\s+)?([a-z_][a-z0-9_]*)/gi)) tables.delete(m[1].toLowerCase());
if (tables.size < 20) { no('the schema was found', `only ${tables.size} tables parsed out of migrations/`); process.exit(1); }
ok('the schema was read from migrations/', `${tables.size} tables`);

/**
 * Columns the database fills on its own. `created_at timestamptz not null default now()` needs no
 * writer and never will, so a gate naming it explicitly — to plant a row of a given age — is not
 * evidence that a feature is missing. Parsed from the DDL rather than listed here, because a list
 * of column names in a gate is the thing that goes stale.
 */
const defaulted = new Set();
for (const t of schema.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?([a-z_][a-z0-9_]*)\s*\(([\s\S]*?)\n\s*\);/gi)) {
  const table = t[1].toLowerCase();
  for (const line of t[2].split('\n')) {
    const m = /^\s*([a-z_][a-z0-9_]*)\s+[^,]*\bdefault\b/i.exec(line);
    if (m && !/^(primary|unique|foreign|constraint|check)$/i.test(m[1])) defaulted.add(`${table}.${m[1].toLowerCase()}`);
  }
}
for (const m of schema.matchAll(/alter\s+table\s+([a-z_][a-z0-9_]*)\s+add\s+column\s+(?:if\s+not\s+exists\s+)?([a-z_][a-z0-9_]*)[^;]*?\bdefault\b/gi)) {
  defaulted.add(`${m[1].toLowerCase()}.${m[2].toLowerCase()}`);
}
ok('columns the database fills itself were read from the DDL', `${defaulted.size} with a DEFAULT`);

// ---- who writes what ------------------------------------------------------------------------
// `update X set a = 1, b = 2` and `insert into X (a, b, c)` both name columns. Both are parsed,
// because the fault this exists for has appeared at each level once.
const INSERT = /insert\s+into\s+([a-z_][a-z0-9_]*)\s*(?:\(([^)]*)\))?/gi;
const UPDATE = /update\s+(?:only\s+)?([a-z_][a-z0-9_]*)\s+set\s+([\s\S]{0,600}?)(?:\bwhere\b|\breturning\b|`|;)/gi;

const writers = new Map();          // table -> Set(area)
const colWriters = new Map();       // "table.col" -> Set(area)
const noteWriter = (map, key, area) => { if (!map.has(key)) map.set(key, new Set()); map.get(key).add(area); };

const areaOf = (f) => (f.startsWith('gates/') ? 'gates' : f.startsWith('migrations/') ? 'migrations' : 'ship');

/**
 * THE ONE EXCLUSION, and it is a different kind of writer rather than a favour.
 *
 * `gates/schema-guards.sh` writes rows in order to prove the DATABASE REJECTS THEM — a duplicate
 * phone, a visit on a taken day, a role of 'wizard'. Its inserts are the subject of the test, not
 * a stand-in for a feature nobody wrote, and it supplies explicit primary keys so the reject
 * cases have something to collide with. Counting it made this gate report `customers.id` and
 * `events.hash` as features that had never run, which is the noise that gets a gate switched off.
 *
 * It is excluded from the WRITER scan only. Nothing else here knows it exists.
 */
const NOT_A_FEATURE_WRITER = ['gates/schema-guards.sh'];

const SCAN = [...files('gates/**/*.{mjs,js,ts,sh}'), ...files('migrations/**/*.sql'),
  ...files('server/**/*.ts'), ...files('api/**/*.ts'), ...files('src/**/*.{ts,tsx,astro}'),
  ...files('scripts/**/*.{mjs,js,ts}'), ...files('tests/**/*.{ts,mjs}')]
  .filter((f) => !NOT_A_FEATURE_WRITER.includes(f));

for (const f of SCAN) {
  const area = areaOf(f);
  const body = read(f);
  for (const m of body.matchAll(INSERT)) {
    const t = m[1].toLowerCase();
    if (!tables.has(t)) continue;
    noteWriter(writers, t, area);
    for (const c of (m[2] ?? '').split(',').map((s) => s.trim().toLowerCase()).filter((s) => /^[a-z_][a-z0-9_]*$/.test(s))) {
      noteWriter(colWriters, `${t}.${c}`, area);
    }
  }
  for (const m of body.matchAll(UPDATE)) {
    const t = m[1].toLowerCase();
    if (!tables.has(t)) continue;
    noteWriter(writers, t, area);
    for (const c of [...m[2].matchAll(/(?:^|,)\s*([a-z_][a-z0-9_]*)\s*=/g)].map((x) => x[1].toLowerCase())) {
      noteWriter(colWriters, `${t}.${c}`, area);
    }
  }
}
ok('the tree was scanned for writers', `${SCAN.length} files, ${writers.size} tables written somewhere`);

// ---- the rule, at table level -----------------------------------------------------------------
const gateOnlyTables = [...writers.entries()]
  .filter(([t, areas]) => areas.has('gates') && !areas.has('ship'))
  .map(([t]) => t)
  .sort();

const unexplainedT = gateOnlyTables.filter((t) => strict || !ACCEPTED.has(t));
unexplainedT.length === 0
  ? ok('every table the gates write is written by shipped code too',
      `${[...writers.entries()].filter(([, a]) => a.has('gates')).length} tables touched by gates/`)
  : no('every table the gates write is written by shipped code too',
      unexplainedT.map((t) => `${t} is written ONLY by gates/ — the feature reading it has never run`).join('; '));

// ---- and at column level, which is where the 2026-09 instance lived ---------------------------
const gateOnlyCols = [...colWriters.entries()]
  .filter(([k, areas]) => areas.has('gates') && !areas.has('ship'))
  .map(([k]) => k)
  // A column whose whole table is already reported is the same finding said twice.
  .filter((k) => !gateOnlyTables.includes(k.split('.')[0]))
  .filter((k) => !defaulted.has(k))
  .sort();

const unexplainedC = gateOnlyCols.filter((k) => strict || !ACCEPTED.has(k));
unexplainedC.length === 0
  ? ok('every column the gates write is written by shipped code too', `${colWriters.size} table.column pairs seen`)
  : no('every column the gates write is written by shipped code too',
      unexplainedC.map((k) => `${k} is set ONLY by gates/`).join('; '));

// ---- negative controls: the detector must be able to say yes AND no ---------------------------
// A check that has never fired protects nothing, and this one's whole job is to fire.
console.log('\nnegative controls');
{
  const fake = new Map([['pretend_table', new Set(['gates'])], ['real_table', new Set(['gates', 'ship'])]]);
  const caught = [...fake.entries()].filter(([, a]) => a.has('gates') && !a.has('ship')).map(([t]) => t);
  caught.length === 1 && caught[0] === 'pretend_table'
    ? ok('the detector catches a gates-only table and passes a shared one')
    : no('the detector catches a gates-only table and passes a shared one', caught.join(','));

  // The parser must actually find a column in the two SQL shapes, or the column half is decorative.
  const sample = "insert into payment_methods (customer_id, stripe_pm_id) values ($1,$2)";
  const got = [...sample.matchAll(INSERT)][0];
  got && got[1] === 'payment_methods' && (got[2] ?? '').includes('stripe_pm_id')
    ? ok('the insert parser reads the table and its column list')
    : no('the insert parser reads the table and its column list', JSON.stringify(got?.slice(0, 3)));

  const sample2 = "update visits set state = 'completed', completed_at = now() where id = $1";
  const got2 = [...sample2.matchAll(UPDATE)][0];
  const cols2 = got2 ? [...got2[2].matchAll(/(?:^|,)\s*([a-z_][a-z0-9_]*)\s*=/g)].map((x) => x[1]) : [];
  cols2.includes('state') && cols2.includes('completed_at')
    ? ok('the update parser reads every column in a SET list', cols2.join(', '))
    : no('the update parser reads every column in a SET list', cols2.join(', '));
}

// ---- what this found, printed whether it passed or not ----------------------------------------
console.log('\ntables written by gates/, and by what else:');
for (const [t, areas] of [...writers.entries()].filter(([, a]) => a.has('gates')).sort()) {
  console.log(`  ${t.padEnd(24)} ${[...areas].sort().join(' + ')}`);
}

if (ACCEPTED.size && !strict) {
  console.log('\ndeclared, and still true — `--strict` ignores this list:');
  for (const [k, why] of ACCEPTED) console.log(`  ${k.padEnd(28)} ${why}`);
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
