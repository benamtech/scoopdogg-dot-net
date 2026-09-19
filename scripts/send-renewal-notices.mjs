/**
 * The daily pass over California's post-sale renewal notices.
 *
 *   node scripts/send-renewal-notices.mjs            # send what is due
 *   node scripts/send-renewal-notices.mjs --dry-run  # say what is due, send nothing
 *
 * Three obligations, all in `server/lib/lifecycle.ts`, all quoted in R9 §6 and §8:
 *   §17602(h)     the annual reminder, for every continuous service — not just annual terms
 *   §17602(b)(1)  3–21 days before a promotional price lasting over 31 days ends
 *   §17602(b)(2)  15–45 days before a term of a year or longer renews
 *
 * The fee-change notice (§17602(g)(2)) is NOT here. It is triggered by somebody deciding to
 * change a price, not by the calendar, so it is a function the admin calls — a daily job that
 * announced price changes nobody had made would be worse than no job.
 *
 * SAFE TO RUN AS OFTEN AS YOU LIKE. Every notice is idempotent on the outbox: a non-failed row
 * for the same purpose, subscription and window means it has already gone. `reconcile-deliveries.mjs`
 * is the same shape and says the same thing, for the same reason — until this is a Vercel cron it
 * is a command somebody runs, and a command somebody runs twice must not send twice.
 *
 * IT HAS NEVER SENT ANYTHING. There are no active subscriptions on this system, so every run so
 * far reports zero due. That is the truthful state, not a passing test.
 */
import { compileServer, cleanupCompile } from '../gates/_compile.mjs';
import { loadEnv } from './_env.mjs';

loadEnv();
const dryRun = process.argv.includes('--dry-run');

const out = compileServer();
try {
  const { sendAnnualReminders, sendPromoOrTermNotices } = await import(`${out}/server/lib/lifecycle.js`);

  if (dryRun) {
    // A dry run must not go anywhere near sendEmail, so it re-asks the same questions with the
    // same windows rather than calling the senders with a flag they could ignore.
    const pg = (await import('pg')).default;
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
    const annual = await pool.query(`
      select count(*)::int as n from subscriptions
       where state = 'active' and frequency <> 'one_time'
         and activated_at is not null and activated_at < now() - interval '1 year'`);
    const window = await pool.query(`
      select count(*)::int as n from subscriptions
       where state = 'active'
         and ((promo_ends_on between current_date + 3 and current_date + 21)
           or (term_renews_on between current_date + 15 and current_date + 45))`);
    await pool.end();
    console.log(JSON.stringify({
      dry_run: true,
      annual_reminders_due: annual.rows[0].n,
      promo_or_term_notices_due: window.rows[0].n,
    }, null, 1));
  } else {
    const annual = await sendAnnualReminders();
    const window = await sendPromoOrTermNotices();
    console.log(JSON.stringify({
      annual_reminders: annual,       // { considered, sent }
      promo_or_term_notices: window,  // { owed, sent }
    }, null, 1));
  }
} finally {
  cleanupCompile();
}
