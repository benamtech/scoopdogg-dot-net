/**
 * A completion photo can be stored, served, deduped and pruned — and the chain behind it moves.
 *
 *   node gates/visit-photos.mjs
 *
 * WHAT THIS GATE IS FOR. Until 2026-09-22 this project had a five-link chain in which the first
 * link was missing and the last link was the highest-return growth item in R8:
 *
 *   no photo storage
 *     -> visit.complete refuses           (visits.ts, and it said so by name)
 *     -> visits.completed_at stays null
 *     -> `count(v.id) >= 3` never true    (comms.ts, eligibleForReviewRequest)
 *     -> the review request can never fire
 *
 * Nothing in the tree could see that, because every link was individually correct. `gates/
 * lead-comms.mjs` proved the review request fires on three completed visits, planting the
 * completed visits itself — so it passed while no code path in production could produce one. This
 * gate is the missing joint: it starts at the bytes and ends at eligibility, and it calls the
 * SHIPPED functions the whole way.
 *
 * HOW IT RUNS WITHOUT A MIGRATION HAVING BEEN APPLIED. It reads `migrations/029_*.sql`, strips
 * the file's own begin/commit, and applies the body inside the gate's transaction. So the schema
 * under test is the migration's own schema — not a table the gate invented, which would be the
 * "verifier reads from a different path" defect — and the gate is green before the migration is
 * applied anywhere, which is what lets it be the thing that says it is safe to apply.
 *
 * NOTHING SURVIVES. One transaction, rolled back in a `finally`. This project has left gate rows
 * in a client's live database before (Summit, 10 of 15 leads).
 *
 * WHY completeVisit IS TESTED WITHOUT WRITING A VISIT. It opens its own pooled client and
 * commits, so it cannot join this transaction, and giving it one would mean its `commit` ending
 * ours. Its photo check happens BEFORE it touches the database, so it is falsified on a visit id
 * that does not exist: with a photo URL the error is `not_found` (the photo check passed), and
 * without one it is `photo_required` (the photo check stopped it). Two different codes on the
 * same non-existent row is the whole distinction, and it writes nothing.
 */
import { readFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import pg from 'pg';
import { compileServer, cleanupCompile } from './_compile.mjs';
import { loadEnv } from '../scripts/_env.mjs';

loadEnv();
let pass = 0, fail = 0;
const ok = (w, d = '') => { pass++; console.log(`  PASS  ${w}${d ? ` — ${d}` : ''}`); };
const no = (w, d = '') => { fail++; console.log(`  FAIL  ${w}${d ? ` — ${d}` : ''}`); };
const check = (c, w, d = '') => (c ? ok(w, d) : no(w, d));

const MIGRATION = 'migrations/029_a_completion_photo_has_somewhere_to_live.sql';

/** A real 1x1 JPEG, so the mime the code is told is the mime the bytes are. */
const JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNCwsLDBkSEw8UHRofHh0aHBwcJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPDIzM//AABEIAAEAAQMBIgACEQEDEQH/xAAfAAABBQEBAQEBAQAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4eLj5OXm5+jp6vHy8/T19vf4+fr/2gAMAwEAAhEDEQA/AJgD/9k=',
  'base64');

// ---- A. the wiring, read from the files that would have to change -------------------------
console.log('A. the route, the permission and the migration exist');
{
  const admin = readFileSync('api/admin.ts', 'utf8');
  const vercel = JSON.parse(readFileSync('vercel.json', 'utf8'));
  const photoApi = readFileSync('api/photo.ts', 'utf8');
  const visits = readFileSync('server/lib/visits.ts', 'utf8');

  check(/path === 'visits\/photo' && req\.method === 'POST'/.test(admin),
    'the admin accepts an upload', '/api/admin?path=visits/photo');
  check(/CREW_PATHS = new Set\(\[[^\]]*'visits\/photo'/.test(admin),
    'a crew session may upload one', 'the person in the yard takes the photo');
  check((vercel.rewrites ?? []).some((r) => r.source === '/api/photo/:id' && r.destination === '/api/photo'),
    'the served URL has a route', '/api/photo/:id -> /api/photo');
  check(/X-Robots-Tag/.test(photoApi) && /noimageindex/.test(photoApi),
    'a capability URL is kept out of the index', 'X-Robots-Tag: noindex, noimageindex');
  // THE MECHANISM, NOT A PHRASE. The first version of this check was `!/no photo storage/` and it
  // failed on visits.ts's own account of the change — the words are legitimately in the history.
  // What matters is that the readiness answer comes from a QUERY and not from a constant, so the
  // check reads the body of the function and requires the call to be in it.
  const readiness = /export async function completionReadiness[\s\S]*?\n}/.exec(visits)?.[0] ?? '';
  check(/await photosAvailable\(/.test(readiness),
    'completionReadiness asks the database whether storage exists',
    'a hardcoded claim about the environment is the shape this project keeps retracting');
  // The refusal must come AFTER the query, not instead of it. Order is the whole difference
  // between "we asked and the answer was no" and "we assumed no".
  const askAt = readiness.indexOf('await photosAvailable(');
  const refuseAt = readiness.indexOf('ready: false');
  check(askAt >= 0 && refuseAt > askAt,
    'and every refusal is downstream of that query',
    askAt < 0 ? 'no query at all' : `asks at ${askAt}, refuses at ${refuseAt}`);
  // The URL that goes into visits.photo_urls must satisfy that column's own ^https?:// filter.
  check(/\$\{SITE\(\)\}\/api\/photo\//.test(readFileSync('server/lib/photos.ts', 'utf8')),
    'the stored URL is absolute', 'completeVisit() filters photo_urls on ^https?://');

  // A RETENTION POLICY NOTHING CALLS DOES NOT EXIST. prune() was written, gated, and called by
  // nobody on its first commit — the same shape as rate_cards and photo_urls before it. There is
  // no scheduler on this project (`vercel.json` has no crons key), so the only place it can run
  // is a sweep the admin triggers on read.
  const comms = readFileSync('server/lib/comms.ts', 'utf8');
  check(/prunePhotos\(/.test(comms) && /runCommsSweeps/.test(comms),
    'photo retention is actually called', 'from runCommsSweeps, the only read-time sweep there is');
  check(/path === 'growth'/.test(admin) || /runCommsSweeps\(\)/.test(admin),
    'and that sweep is reachable from the admin', 'or nothing ever triggers it');
}

// ---- B. the shipped functions, against the migration's own schema, rolled back -------------
console.log('\nB. store, serve, dedupe, cap and prune — the real functions');
{
  const out = compileServer();
  const load = (f) => import(`${process.cwd()}/${out}/server/lib/${f}`.replace(`${process.cwd()}/${process.cwd()}`, process.cwd()));
  const photos = await load('photos.js');
  const { completeVisit, completionReadiness } = await load('visits.js');
  const { eligibleForReviewRequest } = await load('comms.js');

  const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: true } });
  await c.connect();
  try {
    await c.query(`set lock_timeout = '5s'`);
    await c.query('begin');

    // Before the migration: the honest "no".
    const hadTable = await photos.available(c);
    if (!hadTable) {
      const r = await completionReadiness(c);
      check(r.ready === false && /photo storage/.test(r.reason ?? ''),
        'with no storage, the admin is told why rather than shown a button', r.reason?.slice(0, 60));
    } else {
      ok('storage is already applied on this database', 'the no-storage branch is exercised by the drop below');
    }

    // Apply 029's own body. Stripping begin/commit is what stops the migration ending our
    // transaction; anything else that looked like transaction control would be a refusal.
    const body = readFileSync(MIGRATION, 'utf8')
      .replace(/^[ \t]*begin[ \t]*;[ \t]*$/gim, '').replace(/^[ \t]*commit[ \t]*;[ \t]*$/gim, '');
    if (/\b(commit|rollback|savepoint)\b/i.test(body.replace(/--[^\n]*/g, ''))) {
      no('029 contains only begin/commit as transaction control', 'REFUSING to run it inside this transaction');
      throw new Error('migration 029 has transaction control this gate will not run');
    }
    if (!hadTable) await c.query(body);

    check(await photos.available(c) === true, 'after 029, storage is available', 'to_regclass finds visit_photos');
    const ready = await completionReadiness(c);
    check(ready.ready === true && ready.requiresPhoto === true,
      'and the completion action becomes offerable with the requirement still ON',
      'the requirement was never turned off to unblock this');

    // Plant a customer with a subscription and one scheduled visit.
    const { rows: [cust] } = await c.query(
      `insert into customers (name, email, phone) values ('GATE visit-photos', 'gate+photos@example.invalid', '8055550001') returning id`);
    const { rows: [prop] } = await c.query(
      `insert into properties (customer_id, address, city, postal_code) values ($1, '2 Gate Way', 'Ventura', '93001') returning id`, [cust.id]);
    const { rows: [sub] } = await c.query(
      `insert into subscriptions (customer_id, property_id, service_slug, state, monthly_price_cents, source)
       values ($1, $2, 'weekly-pooper-scooper-service', 'active', 10000, 'online') returning id`, [cust.id, prop.id]);
    const { rows: [visit] } = await c.query(
      `insert into visits (subscription_id, property_id, scheduled_for, state)
       values ($1, $2, current_date, 'scheduled') returning id`, [sub.id, prop.id]);

    // ---- store and serve
    const stored = await photos.put({ visitId: visit.id, bytes: JPEG, mime: 'image/jpeg' }, c);
    check(!!stored.id && /^https:\/\/.+\/api\/photo\/[0-9a-f-]{36}$/.test(stored.url) && stored.deduped === false,
      'a photo is stored and gets an absolute URL', stored.url.replace(/https:\/\/[^/]+/, ''));
    const got = await photos.get(stored.id, c);
    check(!!got && Buffer.compare(got.bytes, JPEG) === 0 && got.mime === 'image/jpeg',
      'the bytes that come back are the bytes that went in',
      got ? `${got.bytes.length}B ${got.mime}` : 'nothing came back');
    check(createHash('sha256').update(got.bytes).digest('hex') === createHash('sha256').update(JPEG).digest('hex'),
      'byte-for-byte, by hash', 'a truncated read would pass a length check');

    // ---- dedupe: the same bytes twice is one photo
    const again = await photos.put({ visitId: visit.id, bytes: JPEG, mime: 'image/jpeg' }, c);
    const { rows: [{ n: afterTwo }] } = await c.query(`select count(*)::int as n from visit_photos where visit_id = $1`, [visit.id]);
    check(again.deduped === true && again.id === stored.id && afterTwo === 1,
      'the same bytes uploaded twice is one photo', 'a crew member tapping a slow button');

    // ---- the per-visit cap, and that dedupe does not consume one
    const two = Buffer.concat([JPEG, Buffer.from([0])]);
    const three = Buffer.concat([JPEG, Buffer.from([0, 0])]);
    const four = Buffer.concat([JPEG, Buffer.from([0, 0, 0])]);
    await photos.put({ visitId: visit.id, bytes: two, mime: 'image/jpeg' }, c);
    await photos.put({ visitId: visit.id, bytes: three, mime: 'image/jpeg' }, c);
    let capped = null;
    try { await photos.put({ visitId: visit.id, bytes: four, mime: 'image/jpeg' }, c); }
    catch (e) { capped = e.code; }
    check(capped === 'too_many', 'the fourth new photo is refused', `visit.photos_per_visit_max — code ${capped}`);
    const dupAtCap = await photos.put({ visitId: visit.id, bytes: JPEG, mime: 'image/jpeg' }, c);
    check(dupAtCap.deduped === true, 'but a re-upload of one it already has still succeeds at the cap',
      'the count is checked before the insert and a dedupe is not an insert');

    // ---- the size cap and the mime set
    let big = null;
    try { await photos.put({ visitId: visit.id, bytes: Buffer.alloc(1_000_001, 7), mime: 'image/jpeg' }, c); }
    catch (e) { big = e.code; }
    check(big === 'too_big', 'a photo over the cap is refused', `visit.photo_max_bytes — code ${big}`);
    let mime = null;
    try { await photos.put({ visitId: visit.id, bytes: JPEG, mime: 'image/gif' }, c); }
    catch (e) { mime = e.code; }
    check(mime === 'bad_mime', 'a GIF is refused', `code ${mime}`);
    let empty = null;
    try { await photos.put({ visitId: visit.id, bytes: Buffer.alloc(0), mime: 'image/jpeg' }, c); }
    catch (e) { empty = e.code; }
    check(empty === 'empty', 'an empty file is refused', `code ${empty}`);

    // ---- completeVisit's photo requirement, falsified in both directions, writing nothing
    const ghost = randomUUID();
    const codeOf = async (urls) => {
      try { await completeVisit({ visitId: ghost, photoUrls: urls }); return 'no error'; }
      catch (e) { return e.code ?? e.message; }
    };
    check(await codeOf([]) === 'photo_required',
      'with the requirement on, a completion with no photo is refused', 'before it touches the database');
    check(await codeOf([stored.url]) === 'not_found',
      'and with a photo it gets past the photo check', 'not_found is the next failure, on a visit id that does not exist');

    // ---- the chain: a completed visit now reaches the review request
    const mine = async (delay = 0) => (await eligibleForReviewRequest(3, c, delay)).filter((r) => r.customer_id === cust.id);
    check((await mine()).length === 0, 'one scheduled visit is not eligible for a review request');

    // Distinct completion timestamps, oldest first, so `row_number()` is deterministic and the
    // THIRD visit is identifiable. Equal timestamps would make the ordering arbitrary and the
    // delay checks below meaningless.
    await c.query(
      `update visits set state = 'completed', completed_at = now() - interval '20 days',
              scheduled_for = current_date - 20, photo_urls = array[$2::text] where id = $1`,
      [visit.id, stored.url]);
    for (const [day, ago] of [[13, 13], [6, 6], [0, 0]]) {
      await c.query(
        `insert into visits (subscription_id, property_id, scheduled_for, state, completed_at, photo_urls)
         values ($1, $2, current_date - $3::int, 'completed', now() - ($4 || ' days')::interval, array[$5::text])`,
        [sub.id, prop.id, day, String(ago), stored.url]);
    }
    const hit = await mine();
    check(hit.length === 1 && Number(hit[0].done) === 4,
      'completed visits WITH photos reach the review request',
      'the link that did not exist: none of these completions could have been produced before today');

    // ---- the delay (migration 030, Jung et al. 2023)
    // The qualifying visit — the THIRD — completed 6 days ago. The most recent completed today.
    check((await mine(5)).length === 1,
      'with a 5-day delay, a customer whose THIRD visit was 6 days ago is eligible',
      'even though their most recent visit was today');
    check((await mine(9)).length === 0,
      'with a 9-day delay the same customer is not yet',
      'the delay is actually read, rather than accepted and ignored');

    /**
     * THE DISCRIMINATING CASE, and the reason this is not one check. A naive implementation
     * measures the delay from the LATEST completion. For a weekly customer that clock resets
     * every seven days, so the ask never arrives — a delay that silently means "never". The two
     * implementations agree on every customer whose latest visit IS their third, which is most
     * of them, so only a customer with a fourth visit can tell them apart. That is why the plant
     * above has four.
     *
     * max(completed_at) here is today, so a latest-completion implementation would report 0
     * eligible at delay 5. The check above requires 1.
     */
    const { rows: [{ latest, third }] } = await c.query(
      `select max(completed_at) as latest,
              (array_agg(completed_at order by completed_at))[3] as third
         from visits where subscription_id = $1 and state = 'completed'`, [sub.id]);
    check(new Date(latest) > new Date(third),
      'and the plant really does distinguish the two clocks',
      `third ${new Date(third).toISOString().slice(0, 10)}, latest ${new Date(latest).toISOString().slice(0, 10)} — if these were equal the two checks above would be vacuous`);

    // ---- prune clears the bytes AND the URLs that pointed at them
    await c.query(`update visit_photos set created_at = now() - interval '400 days' where visit_id = $1`, [visit.id]);
    const pruned = await photos.prune(c);
    const { rows: [{ n: left }] } = await c.query(`select count(*)::int as n from visit_photos where visit_id = $1`, [visit.id]);
    const { rows: [{ u }] } = await c.query(`select coalesce(array_length(photo_urls, 1), 0) as u from visits where id = $1`, [visit.id]);
    check(pruned.deleted >= 3 && left === 0,
      'retention deletes the bytes', `${pruned.deleted} deleted past ${pruned.retentionDays} days`);
    check(Number(u) === 0,
      'and clears the URLs that pointed at them',
      'otherwise a completed visit keeps a row of links to 404s');

    // ---- negative controls
    console.log('\nnegative controls');
    check(await photos.get('not-a-uuid', c) === null,
      'a non-uuid is refused without asking the database', 'this endpoint is not a probe');
    check(await photos.get(randomUUID(), c) === null, 'an unknown uuid is null, not an error');
    await c.query('drop table visit_photos');
    check(await photos.available(c) === false,
      'with the table gone, available() says so', 'the detector is not stuck on true');
    const after = await completionReadiness(c);
    check(after.ready === false,
      'and completionReadiness goes back to refusing', 'so the A-section check above was not passing by accident');
    let noStore = null;
    try { await photos.put({ visitId: visit.id, bytes: JPEG, mime: 'image/jpeg' }, c); }
    catch (e) { noStore = e.code; }
    check(noStore === 'no_storage', 'and put() reports no_storage rather than crashing', `code ${noStore}`);
  } catch (e) {
    no('the gate ran to the end', String(e.message ?? e));
  } finally {
    await c.query('rollback').catch(() => {});
    await c.end().catch(() => {});
    cleanupCompile();
  }
}

console.log(`\n${fail ? `FAIL ${fail} of ${pass + fail}` : `PASS ${pass}/${pass}`}`);
process.exit(fail ? 1 : 0);
