/**
 * A particular job can be quoted, approved and paid for — deposit and balance — with AMTECH's fee
 * on both, and California's rules on install work hold at every step.
 *
 *   node gates/quote-rail.mjs [--static]
 *
 * WHAT IT RUNS. Every transition in server/lib/quotes.ts, through the shipped functions, with this
 * gate's own client inside a transaction that is always rolled back — so no lead, quote, customer
 * or payment row outlives it. The money is real Stripe test mode: a deposit Checkout paid with a
 * test card in a headless browser, then the balance charged off-session to the card that deposit
 * saved. Each fee is compared with the platform's own ApplicationFee object, a different path to
 * the same fact.
 *
 * WHAT IT DOES NOT TOUCH. Mail goes to Resend's sandbox (SD_FORCE_DEMO with a resend.dev address),
 * never to the owner or a person, and the outbox rows it leaves are counted and removed. The
 * Stripe customers it creates in test mode are deleted.
 *
 * Every rule has a negative control, and the rules that protect somebody — the deposit cap, the
 * licence, the written contract — are each tried on the side that must pass and the side that must
 * refuse. A detector that cannot go red is not a detector.
 */
import pg from 'pg';
import path from 'node:path';
import { compileServer, cleanupCompile } from './_compile.mjs';
import { payCheckout } from './_pay-checkout.mjs';
import { loadEnv } from '../scripts/_env.mjs';

loadEnv();
const STAMP = Date.now().toString().slice(-8);
process.env.SD_FORCE_DEMO = '1';
process.env.SD_DEMO_ADDRESS = `delivered+sd-quote-rail-${STAMP}@resend.dev`;
const LIVE = !process.argv.includes('--static');

let pass = 0, fail = 0, skip = 0;
const ok = (w, d = '') => { pass++; console.log(`  PASS  ${w}${d ? ` — ${d}` : ''}`); };
const no = (w, d = '') => { fail++; console.log(`  FAIL  ${w}${d ? ` — ${d}` : ''}`); };
const check = (c, w, d = '') => (c ? ok(w, d) : no(w, d));
const skipped = (w, why) => { skip++; console.log(`  SKIP  ${w} — ${why}`); };
const refuses = async (fn, code) => {
  try { await fn(); return { refused: false, code: null }; }
  catch (e) { return { refused: e?.code === code, code: e?.code ?? e?.message }; }
};

const out = compileServer();
const p = (f) => path.resolve(out, f);
const M = await import(p('src/shared/quote-math.js'));
const K = await import(p('src/shared/quote-contract.js'));
const Q = await import(p('server/lib/quotes.js'));
const { get: getPhoto } = await import(p('server/lib/photos.js'));
const { growthBoard } = await import(p('server/lib/growth.js'));

// ───────────────────────────────────────────────────────────── A. the arithmetic
console.log('A. the arithmetic, and California\'s numbers in it');
check(M.improvementCapCents(300_000) === 30_000, 'the cap on a $3,000 install is 10%: $300');
check(M.improvementCapCents(2_000_000) === 100_000, 'the cap on a $20,000 install is $1,000, not 10%');
{
  const inst = M.depositFor(300_000, { mode: 'percent', percent: 25 }, true);
  const svc = M.depositFor(300_000, { mode: 'percent', percent: 25 }, false);
  check(inst.cents === 30_000 && inst.capped && inst.asked === 75_000, 'a 25% deposit on install work is cut to the cap', `${inst.cents} of ${inst.asked}`);
  check(svc.cents === 75_000 && !svc.capped, 'NEGATIVE CONTROL: the same deposit on a clean-up is not capped', `${svc.cents}`);
  check(M.depositFor(300_000, { mode: 'fixed', fixedCents: 5_000 }, true).cents === 5_000, 'a deposit inside the cap is left alone');
  check(M.depositFor(10_000, { mode: 'fixed', fixedCents: 50_000 }, false).cents === 10_000, 'a deposit never exceeds the job');
}
check(!M.needsLicence(true, 99_999) && M.needsLicence(true, 100_000) && !M.needsLicence(false, 10_000_000),
  'a licence is needed from $1,000 on install work, never on service work');
check(!M.needsWrittenContract(true, 50_000) && M.needsWrittenContract(true, 50_001),
  'the written contract starts above $500');
{
  const lines = [{ id: 'a', description: 'x', amount_cents: 100_00, optional: false }, { id: 'b', description: 'y', amount_cents: 25_00, optional: true }];
  check(M.quoteTotals(lines).total === 10_000 && M.quoteTotals(lines, ['b']).total === 12_500, 'optional lines count only when chosen');
}
check(K.cancelBy('2026-11-25', 3) === '2026-12-01', 'the cancel-by date skips Thanksgiving and the weekend (errs late, never early)');

if (!process.env.DATABASE_URL) { console.log('\n  NOT MEASURED: no DATABASE_URL'); process.exit(fail ? 1 : 0); }

const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: true } });
await c.connect();
// A connection error must reach the finally below, not crash the process past its cleanup.
c.on('error', (e) => { console.log(`  (connection error: ${e.message})`); });
await c.query(`set lock_timeout = '5s'`);
// The browser pays inside this transaction; Neon ends a transaction idle for longer than its
// default, which the first run of this gate measured. This session only, never the database's.
await c.query(`set idle_in_transaction_session_timeout = '15min'`);
const outboxBefore = (await c.query(`select count(*)::int as n from outbox`)).rows[0].n;
const stripeCustomersMade = [];
const BASE = 'https://example.com';
const BY = 'gate+quote-rail@example.invalid';
const email = (tag) => `delivered+sd-quote-${tag}-${STAMP}@resend.dev`;
const jpeg = (n) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(`gate photo ${n} ${STAMP}`), Buffer.from([0xff, 0xd9])]);
const setSetting = (k, v) => c.query(`update settings set value = $2::jsonb where key = $1`, [k, JSON.stringify(v)]);

let resolveStripe = null;
try {
  await c.query('begin');
  const phone = `805555${STAMP.slice(-4)}`;

  // ─────────────────────────────────────────────────────────── B. the request
  console.log('\nB. somebody describes a particular job');
  check((await refuses(() => Q.requestQuote(c, { name: 'A', phone: '', email: '' }), 'contact_required')).refused, 'no contact details is refused with a sentence');
  check((await refuses(() => Q.requestQuote(c, { name: 'A', phone: '123', email: 'a@b.co', description: 'x', city: 'Ventura' }), 'bad_phone')).refused, 'a phone Josue cannot text is refused');
  check((await refuses(() => Q.requestQuote(c, { name: 'A', phone: '8055550100', email: 'a@b.co', city: 'Ventura' }), 'describe_the_job')).refused, 'a request that says nothing about the job is refused');
  const req = await Q.requestQuote(c, {
    name: `Gate Customer ${STAMP}`, phone, email: email('a'), address: '1 Gate St, Ventura, CA 93001', city: 'Ventura',
    job_kinds: ['landscaping', 'haul_away', 'not-a-kind'], description: 'Tear out the old lawn, lay turf, haul the green waste.',
    timing: 'month', contact_pref: 'text', source_page: '/custom-quote',
  });
  const { rows: [lead] } = await c.query(`select * from leads where request_token = $1`, [req.token]);
  check(lead?.kind === 'custom' && lead.status === 'new' && lead.postal_code === '93001', 'the request is a custom lead with its ZIP', lead ? `${lead.kind}/${lead.status}/${lead.postal_code}` : 'none');
  check(JSON.stringify(lead?.job_kinds) === JSON.stringify(['landscaping', 'haul_away']), 'only known job kinds are kept', JSON.stringify(lead?.job_kinds));
  check(req.token.length >= 32, 'the link carries a capability token', `${req.token.length} chars`);

  const ph = await Q.addRequestPhoto(c, req.token, jpeg(1), 'image/jpeg');
  const again = await Q.addRequestPhoto(c, req.token, jpeg(1), 'image/jpeg');
  check(!ph.deduped && again.deduped && again.id === ph.id, 'the same photo twice is one photo');
  const served = await getPhoto(ph.id, c);
  check(served && served.bytes.equals(jpeg(1)), 'a request photo is served from the capability URL');
  check((await getPhoto('00000000-0000-4000-8000-000000000000', c)) === null, 'NEGATIVE CONTROL: an id that is not a photo serves nothing');
  const maxBytes = Number((await c.query(`select value from settings where key = 'quote.photo_max_bytes'`)).rows[0]?.value ?? 900000);
  check((await refuses(() => Q.addRequestPhoto(c, req.token, Buffer.alloc(maxBytes + 1, 1), 'image/jpeg'), 'too_big')).refused, 'a photo over the limit is refused');
  check((await refuses(() => Q.addRequestPhoto(c, 'x'.repeat(32), jpeg(2), 'image/jpeg'), 'not_found')).refused, 'NEGATIVE CONTROL: a made-up token uploads nothing');
  const v0 = await Q.viewQuote(c, req.token, { count: true });
  check(v0.stage === 'received' && v0.request.photos.length === 1, 'before a quote, the page says it was received and shows the photo', v0.stage);

  // ─────────────────────────────────────────────────────────── C. the owner prices it
  console.log('\nC. Josue prices it');
  const d0 = await Q.draftQuote(c, lead.id, BY);
  check(d0.state === 'draft' && d0.is_improvement === true && d0.deposit_percent === 25, 'a draft starts from the request: install work guessed, 25% deposit', `improvement=${d0.is_improvement}`);
  check((await Q.draftQuote(c, lead.id, BY)).id === d0.id, 'opening the builder twice does not make two drafts');
  check((await refuses(() => Q.saveQuote(c, d0.id, { lines: [{ description: 'x', amount_cents: -1 }] }, BY), 'bad_amount')).refused, 'a negative line is refused');
  check((await refuses(() => Q.saveQuote(c, d0.id, { lines: [{ description: '', amount_cents: 100 }] }, BY), 'line_needs_words')).refused, 'a line with no words is refused');
  await Q.saveQuote(c, d0.id, {
    title: 'Lawn to turf, with haul-away', message: 'Priced from your photos and my visit on Tuesday.',
    approx_start: 'Within two weeks of approval', approx_completion: 'Two working days after starting',
    lines: [
      { description: 'Remove existing lawn and prepare base', amount_cents: 180_000 },
      { description: 'Supply and lay artificial turf, 600 sq ft', amount_cents: 120_000 },
      { description: 'Haul away all green waste', amount_cents: 25_000, optional: true },
    ],
  }, BY);
  const own = await Q.quoteForOwner(c, d0.id);
  check(own.numbers.required === 300_000 && own.numbers.optionalAvailable === 25_000, 'the builder reads the totals from the lines', `${own.numbers.required}/${own.numbers.optionalAvailable}`);
  check(own.numbers.depositOnRequired.capped && own.numbers.depositOnRequired.cents === 30_000, 'the builder shows the deposit cut to the cap before anything is sent');

  // The install boundary, while the facts are unknown. Each side is tried.
  for (const k of ['business.license_number', 'business.legal_name', 'business.mailing_address', 'contract.cgl', 'contract.workers_comp']) await setSetting(k, null);
  check(own.contract.gaps.length > 0, 'the builder names what an install contract still needs', own.contract.gaps.join('; '));
  check((await refuses(() => Q.sendQuote(c, d0.id, { by: BY, base: BASE, mode: 'test' }), 'licence_required')).refused, 'install work of $1,000+ cannot be sent without a licence number');
  {
    const small = await Q.requestQuote(c, { name: `Gate Small ${STAMP}`, phone: `805556${STAMP.slice(-4)}`, email: email('s'), city: 'Ventura', job_kinds: ['turf'], description: 'Patch a turf corner' });
    const sl = (await c.query(`select id from leads where request_token = $1`, [small.token])).rows[0];
    const sd = await Q.draftQuote(c, sl.id, BY);
    await Q.saveQuote(c, sd.id, { lines: [{ description: 'Patch turf corner', amount_cents: 80_000 }] }, BY);
    check((await refuses(() => Q.sendQuote(c, sd.id, { by: BY, base: BASE, mode: 'test' }), 'contract_facts_missing')).refused,
      'an $800 install is a written contract: it names the missing facts rather than sending');
    await Q.saveQuote(c, sd.id, { is_improvement: false }, BY);
    const sent = await Q.sendQuote(c, sd.id, { by: BY, base: BASE, mode: 'test' });
    check(!!sent.url, 'NEGATIVE CONTROL: the same job as service work sends with none of those facts', `#${sent.number}`);
  }
  // The facts arrive (inside this transaction only).
  await setSetting('business.license_number', 'GATE-0000000');
  await setSetting('business.license_class', 'C-27');
  await setSetting('business.legal_name', 'Gate Contractor');
  await setSetting('business.mailing_address', '1 Gate Way, Ventura, CA 93001');
  await setSetting('contract.cgl', { mode: 'none' });
  await setSetting('contract.workers_comp', 'exempt');
  check((await Q.quoteForOwner(c, d0.id)).contract.gaps.length === 0, 'with the facts on record, nothing is missing');

  const sent = await Q.sendQuote(c, d0.id, { by: BY, base: BASE, mode: 'test' });
  const { rows: [qs] } = await c.query(`select * from quotes where id = $1`, [d0.id]);
  const { rows: [sub] } = await c.query(`select * from subscriptions where id = $1`, [qs.subscription_id]);
  check(qs.state === 'sent' && qs.valid_until && qs.customer_id, 'sending the quote makes it sent, dated and addressed to a customer');
  check(sub?.state === 'quote_ready' && sub.source === 'quote' && sub.frequency === 'one_time' && sub.price_cents === 300_000,
    'the job exists as a subscription in quote_ready — the state migration 001 declared and nothing wrote', sub ? `${sub.state}/${sub.source}/${sub.price_cents}` : 'none');
  const { rows: [lead2] } = await c.query(`select status, first_response_at from leads where id = $1`, [lead.id]);
  check(lead2.status === 'quoted' && lead2.first_response_at, 'the lead is quoted and his response time is recorded');
  check(sent.url.endsWith(`/quote/${req.token}`) && sent.sms_href?.startsWith('sms:+1'), 'the owner gets the link and a text to send from his own phone');
  check((await refuses(() => Q.saveQuote(c, d0.id, { title: 'changed' }, BY), 'not_draft')).refused, 'a sent quote is not edited under the customer');

  // ─────────────────────────────────────────────────────────── D. the customer decides
  console.log('\nD. the customer opens it and approves');
  await Q.viewQuote(c, req.token, { count: true });
  const v2 = await Q.viewQuote(c, req.token, { count: true });
  await Q.viewQuote(c, req.token, { count: false });
  const { rows: [qv] } = await c.query(`select view_count, first_viewed_at from quotes where id = $1`, [d0.id]);
  check(qv.view_count === 2 && qv.first_viewed_at, 'each open is counted; a peek is not', `${qv.view_count} views`);
  check(v2.stage === 'quote' && v2.quote.lines.length === 3 && v2.business.licence === 'GATE-0000000', 'the page shows the lines and the licence number');
  const optId = v2.quote.lines.find((l) => l.optional).id;
  const total = 325_000;
  const dep = M.depositFor(total, { mode: 'percent', percent: 25 }, true);
  const terms = M.acceptanceTerms({ businessName: 'Scoop Dogg', number: qs.number, totalCents: total, depositCents: dep.cents, isImprovement: true });
  // Terms that quote a different deposit from the one the server would charge: the browser was shown
  // a number that is not the truth, so the approval must not stand.
  const staleTerms = M.acceptanceTerms({ businessName: 'Scoop Dogg', number: qs.number, totalCents: total, depositCents: dep.cents + 100, isImprovement: true });
  check((await refuses(() => Q.acceptQuote(c, req.token, { quote_id: d0.id, name: 'Gate Customer', chosen: [optId], terms: staleTerms }, { base: BASE }), 'terms_stale')).refused,
    'approval against terms the server would not charge is refused');
  check((await c.query(`select state from quotes where id = $1`, [d0.id])).rows[0].state === 'sent', 'NEGATIVE CONTROL: the refused approval left the quote open');
  check((await refuses(() => Q.acceptQuote(c, req.token, { quote_id: d0.id, name: '', chosen: [optId], terms }, { base: BASE }), 'name_required')).refused, 'approval needs a typed name');

  if (!LIVE) {
    skipped('the deposit, the balance and the refund in Stripe test mode', '--static');
  } else {
    const acc = await Q.acceptQuote(c, req.token, { quote_id: d0.id, name: 'Gate Customer', chosen: [optId], terms, senior: false }, { base: BASE, ip: '127.0.0.1', ua: 'quote-rail gate' });
    const { rows: [qa] } = await c.query(`select * from quotes where id = $1`, [d0.id]);
    const { rows: [suba] } = await c.query(`select state from subscriptions where id = $1`, [qs.subscription_id]);
    check(qa.state === 'accepted' && qa.total_cents === total && qa.deposit_cents === 32_500, 'approval freezes the total with the chosen option and the capped deposit', `${qa.total_cents}/${qa.deposit_cents}`);
    check(suba.state === 'deposit_pending', 'the job moved quote_ready -> quote_accepted -> deposit_pending', suba.state);
    check(typeof acc.checkout_url === 'string' && acc.checkout_url.includes('checkout.stripe.com'), 'the customer is sent to a Stripe Checkout for the deposit');
    const acc2 = await Q.acceptQuote(c, req.token, { quote_id: d0.id, name: 'Gate Customer', chosen: [optId], terms }, { base: BASE });
    check(acc2.checkout_url === acc.checkout_url, 'a second tap on Approve returns the same checkout, not a second charge');

    const { resolve } = await import(p('server/lib/stripe.js'));
    resolveStripe = await resolve('test');
    const { stripe, account } = resolveStripe;
    stripeCustomersMade.push(qa.stripe_customer_id);
    const cs = await stripe.checkout.sessions.retrieve(qa.deposit_checkout, {}, { stripeAccount: account });
    check(cs.amount_total === 32_500 && cs.metadata?.quote_id === d0.id && cs.metadata?.kind === 'quote_deposit', 'the Checkout is for the deposit, and names the quote', `${cs.amount_total}`);

    // ─────────────────────────────────────────────────────── E. the deposit is paid
    console.log('\nE. the deposit is paid, with the fee');
    await payCheckout(acc.checkout_url, { name: 'Gate Customer', leaveTo: /example\.com/, screenshot: '/tmp/quote-rail-deposit.png' });
    const before = await growthBoard(c);
    const conf = await Q.confirmQuotePayment(c, cs.id, { mode: 'test', base: BASE });
    check(conf.paid && !conf.already, 'returning from Stripe records the deposit');
    const { rows: [pd] } = await c.query(
      `select p.kind, p.amount_cents, p.platform_fee_cents, p.stripe_payment_id, i.platform_fee_cents as inv_fee, il.description
         from payments p join invoices i on i.id = p.invoice_id join invoice_lines il on il.invoice_id = i.id
        where i.subscription_id = $1 and p.kind = 'deposit'`, [qs.subscription_id]);
    const pi = await stripe.paymentIntents.retrieve(pd.stripe_payment_id, {}, { stripeAccount: account });
    let afDep;
    for (let i = 0; i < 10 && !afDep; i++) {
      afDep = (await stripe.applicationFees.list({ charge: pi.latest_charge, limit: 1 })).data[0];
      if (!afDep) await new Promise((r) => setTimeout(r, 1500));
    }
    check(pd.amount_cents === 32_500 && pd.platform_fee_cents === afDep?.amount && pd.inv_fee === afDep?.amount && afDep.amount > 0,
      'the deposit row, its invoice and its line carry the fee Stripe took', `${pd.platform_fee_cents}¢ vs ApplicationFee ${afDep?.amount}¢; line "${pd.description}"`);
    check(pi.setup_future_usage === 'off_session' || !!(await c.query(`select payment_method_id from quotes where id = $1`, [d0.id])).rows[0].payment_method_id,
      'the card is kept for the balance');
    const { rows: [qp] } = await c.query(`select deposit_paid_at, payment_method_id from quotes where id = $1`, [d0.id]);
    const { rows: [subp] } = await c.query(`select state, payment_state from subscriptions where id = $1`, [qs.subscription_id]);
    check(qp.deposit_paid_at && qp.payment_method_id && subp.state === 'active', 'the job is booked: deposit paid, card on file, subscription active', subp.state);
    check((await Q.confirmQuotePayment(c, cs.id, { mode: 'test', base: BASE })).already, 'the webhook arriving second finds it done');
    const after = await growthBoard(c);
    const month = new Date().toISOString().slice(0, 7);
    const fee = (b) => (b.fees_by_month ?? []).find((m) => m.period === month)?.fee_cents ?? 0;
    check(fee(after) - fee(before) === afDep.amount, "the accountant's fee report includes the deposit", `+${fee(after) - fee(before)}¢`);

    // ─────────────────────────────────────────────────────── F. the balance
    console.log('\nF. the work is done; the balance is charged to the saved card');
    const bal = await Q.completeQuoteJob(c, d0.id, { by: BY, method: 'card', base: BASE });
    check(bal.paid && bal.balance === total - 32_500, 'one tap charges the balance', `${bal.balance}`);
    const { rows: [pb] } = await c.query(
      `select p.amount_cents, p.platform_fee_cents, p.stripe_payment_id from payments p join invoices i on i.id = p.invoice_id
        where i.subscription_id = $1 and p.kind = 'charge'`, [qs.subscription_id]);
    const pib = await stripe.paymentIntents.retrieve(pb.stripe_payment_id, {}, { stripeAccount: account });
    // Stripe's list endpoints are eventually consistent: a fee on a charge made a second ago may not
    // be listable yet. Ask until it is, briefly, rather than read "none" as "no fee".
    let afBal;
    for (let i = 0; i < 10 && !afBal; i++) {
      afBal = (await stripe.applicationFees.list({ charge: pib.latest_charge, limit: 1 })).data[0];
      if (!afBal) await new Promise((r) => setTimeout(r, 1500));
    }
    check(pb.amount_cents === 292_500 && pb.platform_fee_cents === afBal?.amount && afBal.amount > 0, 'the balance carries the fee Stripe took', `${pb.platform_fee_cents}¢ vs ${afBal?.amount}¢`);
    check((await refuses(() => Q.completeQuoteJob(c, d0.id, { by: BY, method: 'card', base: BASE }), 'already_paid')).refused, 'NEGATIVE CONTROL: the balance cannot be charged twice');
    const vp = await Q.viewQuote(c, req.token, { count: false });
    check(vp.stage === 'paid', 'the customer\'s page says it is paid', vp.stage);

    // ─────────────────────────────────────────────────────── G. a refunded deposit
    console.log('\nG. a service job: uncapped deposit, then cancelled and refunded');
    const r2 = await Q.requestQuote(c, { name: `Gate Svc ${STAMP}`, phone: `805557${STAMP.slice(-4)}`, email: email('r'), city: 'Oxnard', job_kinds: ['yard_cleanup'], description: 'Overgrown back yard' });
    const l2 = (await c.query(`select id from leads where request_token = $1`, [r2.token])).rows[0];
    const d2 = await Q.draftQuote(c, l2.id, BY);
    check(d2.is_improvement === false, 'a clean-up is not guessed to be install work');
    await Q.saveQuote(c, d2.id, { lines: [{ description: 'Clear overgrown yard', amount_cents: 60_000 }] }, BY);
    const s2 = await Q.sendQuote(c, d2.id, { by: BY, base: BASE, mode: 'test' });
    const q2 = (await c.query(`select number from quotes where id = $1`, [d2.id])).rows[0];
    const t2 = M.acceptanceTerms({ businessName: 'Scoop Dogg', number: q2.number, totalCents: 60_000, depositCents: 15_000, isImprovement: false });
    const a2 = await Q.acceptQuote(c, r2.token, { quote_id: d2.id, name: 'Gate Svc', chosen: [], terms: t2 }, { base: BASE });
    const qa2 = (await c.query(`select * from quotes where id = $1`, [d2.id])).rows[0];
    check(qa2.deposit_cents === 15_000, 'NEGATIVE CONTROL at the flow level: 25% on service work is not capped', `${qa2.deposit_cents}`);
    stripeCustomersMade.push(qa2.stripe_customer_id);
    await payCheckout(a2.checkout_url, { name: 'Gate Svc', leaveTo: /example\.com/ });
    await Q.confirmQuotePayment(c, qa2.deposit_checkout, { mode: 'test', base: BASE });
    const beforeRefund = fee(await growthBoard(c));
    const rf = await Q.refundQuoteDeposit(c, d2.id, BY);
    const { rows: [rr] } = await c.query(`select amount_cents, platform_fee_cents from payments where stripe_payment_id = $1`, [rf.refund]);
    check(rr?.amount_cents === -15_000 && rr.platform_fee_cents < 0, 'the refund is its own negative row, and so is the fee it gave back', JSON.stringify(rr));
    check(fee(await growthBoard(c)) - beforeRefund === rr.platform_fee_cents, 'the fee report nets the refund out');
    const { rows: [sub2] } = await c.query(`select s.state from subscriptions s join quotes q on q.subscription_id = s.id where q.id = $1`, [d2.id]);
    check(sub2.state === 'cancelled', 'the refunded job is cancelled');
    void s2;
  }

  // ─────────────────────────────────────────────────────────── H. the other endings
  console.log('\nH. declined, revised, expired');
  {
    const r3 = await Q.requestQuote(c, { name: `Gate Decline ${STAMP}`, phone: `805558${STAMP.slice(-4)}`, email: email('d'), city: 'Ojai', job_kinds: ['pressure_washing'], description: 'Big driveway' });
    const l3 = (await c.query(`select id from leads where request_token = $1`, [r3.token])).rows[0];
    const d3 = await Q.draftQuote(c, l3.id, BY);
    await Q.saveQuote(c, d3.id, { lines: [{ description: 'Pressure wash driveway', amount_cents: 45_000 }] }, BY);
    await Q.sendQuote(c, d3.id, { by: BY, base: BASE, mode: 'test' });
    await Q.declineQuote(c, r3.token, 'Went with a neighbour', BASE);
    const { rows: [q3] } = await c.query(`select q.state, s.state as sub from quotes q join subscriptions s on s.id = q.subscription_id where q.id = $1`, [d3.id]);
    check(q3.state === 'declined' && q3.sub === 'cancelled', 'a declined quote cancels its job');
    const rev = await Q.reviseQuote(c, d3.id, BY);
    const { rows: [{ n }] } = await c.query(`select count(*)::int as n from quote_lines where quote_id = $1`, [rev.id]);
    check(rev.state === 'draft' && n === 1, 'revising copies it into a new draft, lines and all');
    await Q.sendQuote(c, rev.id, { by: BY, base: BASE, mode: 'test' });
    await c.query(`update quotes set valid_until = current_date - 2 where id = $1`, [rev.id]);
    // Approve FIRST, without opening it: a page loaded before the date and clicked after it. Opening
    // it would expire it on the way in and hide whether approval checks the date for itself.
    const revNo = (await c.query(`select number from quotes where id = $1`, [rev.id])).rows[0].number;
    const t4 = M.acceptanceTerms({ businessName: 'Scoop Dogg', number: revNo, totalCents: 45_000, depositCents: 11_250, isImprovement: false });
    check((await refuses(() => Q.acceptQuote(c, r3.token, { quote_id: rev.id, name: 'Late Customer', chosen: [], terms: t4 }, { base: BASE }), 'expired')).refused,
      'an expired quote cannot be approved, even from a page loaded before the date');
    const ve = await Q.viewQuote(c, r3.token, { count: true });
    const { rows: [q4] } = await c.query(`select q.state, s.state as sub from quotes q join subscriptions s on s.id = q.subscription_id where q.id = $1`, [rev.id]);
    check(ve.stage === 'expired' && q4.state === 'expired' && q4.sub === 'cancelled', 'a quote past its date reads as expired, and its job is cancelled');
  }
} catch (e) {
  no('the gate ran to the end', String(e?.message ?? e).split('\n')[0].slice(0, 300));
} finally {
  await c.query('rollback').catch(() => {});
  // Mail went to Resend's sandbox; the outbox rows are this run's and nothing else's.
  const del = await c.query(`delete from outbox where payload::text like $1`, [`%sd-quote-%${STAMP}%`]).catch(() => ({ rowCount: 0 }));
  const outboxAfter = (await c.query(`select count(*)::int as n from outbox`)).rows[0].n;
  console.log(`\n  cleanup: ${del.rowCount} sandbox outbox rows removed; outbox ${outboxBefore} -> ${outboxAfter}`);
  check(outboxAfter === outboxBefore, 'the gate leaves the outbox as it found it');
  if (resolveStripe) for (const id of stripeCustomersMade.filter(Boolean)) {
    await resolveStripe.stripe.customers.del(id, { stripeAccount: resolveStripe.account }).catch(() => {});
  }
  await c.end();
  cleanupCompile();
}

console.log(`\n${fail ? 'FAIL' : `PASS(${LIVE ? 'live' : 'static'})`} ${pass}/${pass + fail}${skip ? ` (${skip} skipped)` : ''}`);
process.exit(fail ? 1 : 0);
