/**
 * Remove every row belonging to customers a gate created, by their name prefix, in one transaction.
 *
 *   node scripts/cleanup-e2e-customers.mjs 'DEMO—E2E'           # all checkout-e2e leftovers
 *   import { removeTestCustomers } from '../scripts/cleanup-e2e-customers.mjs'   # from a gate
 *
 * WHY. gates/checkout-e2e.mjs books real subscriptions through the real funnel and never removed
 * them. Measured 2026-10-01: 29 test customers, and 20 test visits on Tuesday 6 October — exactly
 * schedule.day_capacity — so the booking page showed that day as Full to everyone. A test that
 * leaves rows in the one database is a test that changes what real customers see.
 *
 * Only names starting with 'DEMO—' are accepted, the mark every gate customer carries. The events
 * table refuses deletes by design (the tamper-evident spine), so a run's events stay; they name
 * rows that no longer exist and no screen reads them.
 */
import pg from 'pg';
import { loadEnv } from './_env.mjs';

export async function removeTestCustomers(prefix, client) {
  if (!prefix.startsWith('DEMO—')) throw new Error('refusing: only DEMO— customers are test customers');
  const own = !client;
  const c = client ?? new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: true } });
  if (own) await c.connect();
  const like = `${prefix}%`;
  const counts = {};
  const del = async (label, sql) => { const r = await c.query(sql, [like]); counts[label] = r.rowCount; };
  const CUST = `select id from customers where name like $1`;
  const SUBS = `select id from subscriptions where customer_id in (${CUST})`;
  const VIS = `select id from visits where subscription_id in (${SUBS})`;
  const INV = `select id from invoices where customer_id in (${CUST})`;
  try {
    await c.query('begin');
    await del('visit_photos', `delete from visit_photos where visit_id in (${VIS})`);
    await del('messages', `delete from messages where customer_id in (${CUST}) or visit_id in (${VIS})`);
    await del('invoice_lines', `delete from invoice_lines where invoice_id in (${INV}) or visit_id in (${VIS})`);
    await del('offer_redemptions', `delete from offer_redemptions where customer_id in (${CUST})`);
    await del('payments', `delete from payments where customer_id in (${CUST})`);
    await del('invoices', `delete from invoices where customer_id in (${CUST})`);
    await del('visits', `delete from visits where subscription_id in (${SUBS})`);
    await del('consents', `delete from consents where customer_id in (${CUST})`);
    await del('customer_invites', `delete from customer_invites where customer_id in (${CUST})`);
    await c.query(`update funnel_sessions set subscription_id = null where subscription_id in (${SUBS})`, [like]);
    await del('quotes_unlinked', `update quotes set subscription_id = null, customer_id = null where customer_id in (${CUST})`);
    await del('subscriptions', `delete from subscriptions where customer_id in (${CUST})`);
    await del('properties', `delete from properties where customer_id in (${CUST})`);
    await del('payment_methods', `delete from payment_methods where customer_id in (${CUST})`);
    await del('stripe_customers', `delete from stripe_customers where customer_id in (${CUST})`);
    await del('sessions', `delete from sessions where customer_id in (${CUST})`);
    await del('customers', `delete from customers where name like $1`);
    await c.query('commit');
  } catch (e) {
    await c.query('rollback').catch(() => {});
    throw e;
  } finally {
    if (own) await c.end();
  }
  return counts;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  loadEnv();
  const prefix = process.argv[2];
  if (!prefix) { console.error("usage: cleanup-e2e-customers.mjs 'DEMO—E2E'"); process.exit(2); }
  const counts = await removeTestCustomers(prefix);
  console.log('  removed', JSON.stringify(counts));
}
