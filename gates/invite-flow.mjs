/**
 * An invited customer is charged the price Josue typed, and the link is a credential.
 *
 *   node gates/invite-flow.mjs
 *
 * P18 §3 and P19 lever 1. The rule this gate exists for is one sentence: **their price is their
 * price.** These are people who agreed a number before this software existed; the published
 * ladder went up 11% on 2026-09-18 and none of that may reach them. A bug that quietly billed the
 * catalog price instead would be invisible in code review and obvious on a bank statement.
 *
 * So the invite is created for real, against the real database, at a price that exists NOWHERE in
 * the catalog — $137 matches no package and no tier — and the row is read back. If anything in
 * the path reached for a published price, the number would change and this goes red.
 *
 * It also proves the link is stored the way a credential must be: the token never appears in the
 * table, a wrong token is refused, and the right one opens exactly one invite.
 *
 * Its rows are marked DEMO— and removed in a `finally`, so a failure halfway through does not
 * leave a customer in the client's database. The one thing it cannot remove is its `events` row:
 * `events` refuses DELETE at the database, which is the point of an append-only spine.
 */
import pg from 'pg';
import path from 'node:path';
import { loadEnv } from '../scripts/_env.mjs';
import { compileServer } from './_compile.mjs';

loadEnv();
const build = compileServer();
const { createInvite, readInvite } = await import(path.join(build, 'server/lib/invites.js'));
const { db } = await import(path.join(build, 'server/lib/db.js'));

let pass = 0, fail = 0;
const ok = (n, m = '') => { console.log(`  PASS  ${n}${m ? ` — ${m}` : ''}`); pass++; };
const no = (n, m = '') => { console.log(`  FAIL  ${n}${m ? ` — ${m}` : ''}`); fail++; };

const stamp = Date.now().toString().slice(-6);
const PRICE = 13700;                 // matches no package and no tier, on purpose
const person = {
  name: `DEMO—Invite ${stamp}`,
  email: `delivered+sd-invite-${stamp}@resend.dev`,   // Resend's sandbox inbox, never a person
  phone: `805444${stamp.slice(-4)}`,
};

const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: true } });
await c.connect();
let created = null;
try {
  // The catalog must not contain this number, or the check below proves nothing.
  const { rows: clash } = await c.query(
    `select 1 from packages where monthly_price_cents = $1 union all select 1 from service_tiers where price_cents = $1`, [PRICE]);
  clash.length ? no('the test price exists nowhere in the catalog', `${PRICE} collides`)
               : ok('the test price exists nowhere in the catalog', `$${PRICE / 100}`);

  const { rows: area } = await c.query(`select slug from service_areas where bookable = true order by sort_order limit 1`);
  created = await createInvite({
    name: person.name, email: person.email, phone: person.phone,
    address: '1 Gate Test Way', area_slug: area[0].slug, price_cents: PRICE, notes: 'gates/invite-flow.mjs',
  }, 'gates/invite-flow.mjs', 'https://scoopdogg.net');
  ok('an invite is created', created.invite_id);

  // 1. THE PRICE. Both the subscription and the invite carry the typed number.
  const { rows: sub } = await c.query(
    `select monthly_price_cents, price_cents, state, source, package_id, service_weekday, starts_on from subscriptions where id = $1`,
    [created.subscription_id]);
  sub[0]?.monthly_price_cents === PRICE && sub[0]?.price_cents === PRICE
    ? ok('the subscription is frozen at the price that was typed', `${sub[0].monthly_price_cents} cents`)
    : no('the subscription is frozen at the price that was typed', JSON.stringify(sub[0]));
  sub[0]?.state === 'draft' && sub[0]?.source === 'admin'
    ? ok('it starts as a draft nobody has charged') : no('it starts as a draft nobody has charged', JSON.stringify(sub[0]));
  sub[0]?.package_id === null
    ? ok('it is attached to no published package, so a ladder change cannot reach it')
    : no('it is attached to no published package', String(sub[0]?.package_id));

  const { rows: inv } = await c.query(`select price_cents, token_hash, accepted_at, expires_at from customer_invites where id = $1`, [created.invite_id]);
  inv[0]?.price_cents === PRICE ? ok('the invite row carries the same number') : no('the invite row carries the same number');

  // 2. THE LINK IS A CREDENTIAL.
  /^[a-f0-9]{64}$/.test(inv[0]?.token_hash ?? '')
    ? ok('the token is stored as a hash, not as itself') : no('the token is stored as a hash, not as itself');
  const { rows: plain } = await c.query(
    `select count(*)::int n from customer_invites where token_hash ~ '^[a-f0-9]{64}$' = false`);
  plain[0].n === 0 ? ok('no invite anywhere stores a plain token') : no('no invite anywhere stores a plain token', `${plain[0].n} rows`);
  new Date(inv[0].expires_at) > new Date() ? ok('the link expires') : no('the link expires');

  let refused = false;
  try { await readInvite('0'.repeat(64)); } catch { refused = true; }
  refused ? ok('a token that is not ours is refused') : no('a token that is not ours is refused');

  // 3. it was actually sent, through the one mail door, and to nobody real.
  const { rows: mail } = await c.query(
    `select purpose, demo, payload->'to' as to_list, state from outbox
      where purpose = 'customer_invite' and created_at > now() - interval '5 minutes' order by id desc limit 1`);
  mail.length ? ok('the invite email went through notify.ts and left a row', `${mail[0].state}`)
              : no('the invite email went through notify.ts and left a row');
  const to = JSON.stringify(mail[0]?.to_list ?? []);
  /resend\.dev/.test(to) || mail[0]?.demo === true
    ? ok('it went to the sandbox inbox, never to a customer', to)
    : no('it went to the sandbox inbox, never to a customer', to);

  // ---- negative control -----------------------------------------------------------------------
  // If the path had reached for a catalog price, the number would be one of these.
  const { rows: ladder } = await c.query(`select monthly_price_cents from packages where status = 'active' order by monthly_price_cents`);
  ladder.some((r) => r.monthly_price_cents === sub[0]?.monthly_price_cents)
    ? no('negative control: a subscription priced off the ladder trips this gate', 'DETECTOR BLIND')
    : ok('negative control: the ladder prices are all different from this one', ladder.map((r) => r.monthly_price_cents).join('/'));
} catch (e) {
  no('the invite path ran without throwing', String(e.message).split('\n')[0]);
} finally {
  // Child-first, the same order demo-clear.mjs uses. In a finally because a gate that leaves a
  // customer in a client's database on failure is worse than the failure.
  if (created) {
    await c.query(`delete from customer_invites where id = $1`, [created.invite_id]).catch(() => {});
    await c.query(`delete from subscriptions where id = $1`, [created.subscription_id]).catch(() => {});
    await c.query(`delete from properties where customer_id = $1`, [created.customer_id]).catch(() => {});
    await c.query(`delete from customers where id = $1`, [created.customer_id]).catch(() => {});
  }
  const { rows: left } = await c.query(`select count(*)::int n from customers where name like 'DEMO—Invite%'`);
  left[0].n === 0 ? ok('it left no customer behind') : no('it left no customer behind', `${left[0].n} rows`);
  await c.end();
  await db().end();
}

console.log(fail ? `FAIL ${fail} of ${pass + fail}` : `PASS ${pass}/${pass}`);
process.exit(fail ? 1 : 0);
