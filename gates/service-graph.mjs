/**
 * Every relation between services is worked out from the work, and nothing shown to a customer
 * contradicts it. A person should not have to notice that deodorizing is already inside a deep clean.
 *
 *   node gates/service-graph.mjs
 *
 * Reads the LIVE rows through the shipped module. NEGATIVE CONTROLS plant the mistakes this exists to
 * catch, including Ben's two: deodorizing offered on a deep clean, and the deep clean offered the other way.
 */
import pg from 'pg';
import { compileServer, cleanupCompile } from './_compile.mjs';
import { loadEnv } from '../scripts/_env.mjs';
loadEnv();
let pass = 0, fail = 0;
const check = (c, w, d = '') => { c ? pass++ : fail++; console.log(`  ${c ? 'PASS' : 'FAIL'}  ${w}${d ? ` — ${d}` : ''}`); };
const out = compileServer();
const { relate, graphProblems, offeredWith, visitPlan } = await import(`${process.cwd()}/${out}/src/shared/service-graph.js`.replace(`${process.cwd()}/${process.cwd()}`, process.cwd()));
const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: true } });
await c.connect();
const q = async (s) => (await c.query(s)).rows;
const g = {
  services: await q(`select slug, name, kind from services where status = 'active'`),
  packages: await q(`select service_slug from packages where status = 'active'`),
  zones: await q(`select slug, name, indoors from property_zones`),
  tasks: await q(`select slug, name, stage from work_tasks`),
  work: await q(`select service_slug, zone_slug, task_slug, depth from service_work`),
  relations: await q(`select base_slug, other_slug, kind, customer_line from service_relations`),
  bundles: (await q(`select b.slug, b.name, b.customer_line, b.base_slug, array_agg(m.service_slug) as members from bundles b join bundle_members m on m.bundle_slug = b.slug group by b.slug`)),
};
await c.end();

const problems = graphProblems(g);
check(problems.length === 0, 'the live catalog has no contradiction', problems.join(' | '));
const is = (a, b, want, why) => check(relate(g, a, b).relation === want, why, `${relate(g, a, b).relation}: ${relate(g, a, b).why}`);
is('turf-deep-clean', 'yard-sanitizing', 'included', 'a turf deep clean already sanitizes');
is('weekly-turf-maintenance', 'yard-sanitizing', 'included', 'Turf Deodorizing already sanitizes');
is('weekly-turf-maintenance', 'turf-deep-clean', 'upgrade', 'a deep clean is never an add-on to deodorizing');
is('turf-deep-clean', 'weekly-turf-maintenance', 'follow_on', 'deodorizing follows a deep clean');
is('turf-deep-clean', 'dog-run-cleanups', 'add_on', 'a dog run is another part of a turf property');
is('weekly-pooper-scooper-service', 'dog-run-cleanups', 'add_on', 'a dog run cleanup does more than weekly scooping');
is('pressure-washing', 'yard-sanitizing', 'add_on', 'pressure washing now has more than scooping to offer');
is('weekly-pooper-scooper-service', 'one-time-dog-poop-cleanup', 'included', 'a cleanup is not sold on top of scooping');
is('kitty-litter-exchange', 'weekly-pooper-scooper-service', 'household', 'indoors and outdoors are different visits');
check(offeredWith(g, 'pressure-washing', 'add_on').length >= 3, 'pressure washing offers real add-ons', offeredWith(g, 'pressure-washing', 'add_on').map((r) => r.other_slug).join(', '));
const plan = visitPlan(g, ['turf-deep-clean', 'dog-run-cleanups']).map((w) => w.task_slug);
check(plan[0] === 'scoop' && plan.indexOf('enzyme') < plan.indexOf('sanitize') && plan.at(-1) === 'rinse', 'a visit runs solids first, enzyme before sanitizer, rinse last', plan.join(' > '));
const missing = g.services.flatMap((a) => g.services.filter((b) => relate(g, a.slug, b.slug).relation === 'add_on' && !g.relations.some((r) => r.base_slug === a.slug && r.other_slug === b.slug)).map((b) => `${a.slug}+${b.slug}`));
console.log(`  note  ${missing.length} calculated pairs are not on offer, by choice: ${missing.join(', ')}`);

const plant = (rows) => graphProblems({ ...g, relations: [...g.relations, ...rows] });
const line = 'Sentence.';
check(plant([{ base_slug: 'turf-deep-clean', other_slug: 'yard-sanitizing', kind: 'add_on', customer_line: line }]).length > 0, 'NEGATIVE CONTROL: sanitizing offered on a deep clean is refused');
check(plant([{ base_slug: 'weekly-turf-maintenance', other_slug: 'turf-deep-clean', kind: 'add_on', customer_line: line }]).length > 0, 'NEGATIVE CONTROL: a deep clean offered as an add-on to deodorizing is refused');
check(plant([{ base_slug: 'turf-deep-clean', other_slug: 'weekly-turf-maintenance', kind: 'add_on', customer_line: line }]).length > 0, 'NEGATIVE CONTROL: a follow-on typed as an add-on is refused');
check(graphProblems({ ...g, work: g.work.filter((w) => w.service_slug !== 'cat-tree-cleaning') }).length > 0, 'NEGATIVE CONTROL: a service with no recorded work is named');
const twin = g.work.filter((w) => w.service_slug === 'one-time-dog-poop-cleanup').map((w) => ({ ...w, service_slug: 'pressure-washing' }));
check(graphProblems({ ...g, work: [...g.work.filter((w) => w.service_slug !== 'pressure-washing'), ...twin] }).some((p) => /same work/.test(p)), 'NEGATIVE CONTROL: the same work under two names is named');
check(g.bundles.length >= 2, 'the visits people ask for are there', g.bundles.map((b) => b.name).join(', '));
check(graphProblems({ ...g, bundles: [{ slug: 'x', name: 'Bad', customer_line: 'x', base_slug: 'turf-deep-clean', members: ['yard-sanitizing'] }] }).length > 0, 'NEGATIVE CONTROL: a bundle offering what its job already includes is refused');
cleanupCompile(out);
console.log(`RESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
