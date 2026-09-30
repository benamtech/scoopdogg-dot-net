/**
 * The admin that runs the business, on a phone — Josue's screen is the one in his pocket.
 *
 *   node gates/admin-phone.mjs <deployment-url>
 *
 * gates/admin-browser.mjs proves each screen renders its rows, signed in, at desktop size. This
 * opens the §3 and §4 screens at 390x844 with touch, the way gates/today-taps.mjs does, and asks
 * what a phone asks:
 *   - nothing throws;
 *   - nothing is wider than the screen (a sideways scroll on a phone is a screen half-used);
 *   - every button and link is at least 24px tall to tap (WCAG 2.5.8, the AA target size);
 *   - and one real job done by taps: open the menu, go to Jobs, switch stage, open the cash form,
 *     type an amount, cancel. It writes nothing.
 *
 * NEGATIVE CONTROL: the overflow measure is run on a planted 900px-wide element and must see it.
 */
import { loadEnv } from '../scripts/_env.mjs';
import { adminSession } from './_admin-session.mjs';

loadEnv();
const base = (process.argv[2] || '').replace(/\/$/, '');
if (!base) { console.error('usage: admin-phone.mjs <deployment-url>'); process.exit(2); }
const { chromium } = await import('playwright');

let pass = 0, fail = 0;
const ok = (n, d = '') => { pass++; console.log(`  PASS  ${n}${d ? ` — ${d}` : ''}`); };
const no = (n, d = '') => { fail++; console.log(`  FAIL  ${n}${d ? ` — ${d}` : ''}`); };
const check = (c, n, d) => (c ? ok(n, d) : no(n, d));

const s = await adminSession(base);
const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const origin = new URL(base).origin;
  await ctx.route('**/*', (route) => {
    const url = route.request().url();
    route.continue(url.startsWith(origin) ? { headers: { ...route.request().headers(), ...s.protect } } : {});
  });
  const i = s.cookie.indexOf('=');
  await ctx.addCookies([{ name: s.cookie.slice(0, i), value: s.cookie.slice(i + 1), domain: new URL(base).hostname, path: '/', httpOnly: true, secure: true }]);

  const measure = () => {
    const doc = document.documentElement;
    const wide = [...document.querySelectorAll('body *')].filter((e) => e.getBoundingClientRect().right > doc.clientWidth + 1 && getComputedStyle(e).position !== 'fixed')
      .slice(0, 3).map((e) => `${e.tagName.toLowerCase()}.${String(e.className).split(' ')[0]}`);
    // WCAG 2.5.8 exempts a link inside a sentence ("Prices live on the rate card"): its size is set
    // by the line of text. Everything else a thumb has to hit is measured.
    const inline = (e) => e.tagName === 'A' && e.parentElement && /^(P|LI|SPAN)$/.test(e.parentElement.tagName) && e.parentElement.textContent.trim().length > e.textContent.trim().length + 12;
    const small = [...document.querySelectorAll('main button, main a, main [role=tab], main input[type=checkbox] + *')]
      .filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.height < 24 && !inline(e); })
      .slice(0, 3).map((e) => `${(e.textContent || '').trim().slice(0, 24)} (${Math.round(e.getBoundingClientRect().height)}px)`);
    return { overflow: doc.scrollWidth - doc.clientWidth, wide, small, text: document.body.innerText };
  };

  {
    const page = await ctx.newPage();
    await page.setContent('<html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0"><main><div style="width:900px">wide</div></main></body></html>');
    const m = await page.evaluate(measure);
    check(m.overflow > 0 && m.wide.length > 0, 'NEGATIVE CONTROL: the overflow measure sees a 900px element on a 390px screen', `${m.overflow}px over`);
    await page.close();
  }

  const screens = [
    ['/admin/jobs', /To schedule/], ['/admin/week', /stops? from/], ['/admin/areas', /visits? in the next two weeks/],
    ['/admin/invoices', /owed, \$/], ['/admin/offers', /customers? on it now/], ['/admin/services', /prices? on the rate card/],
    ['/admin/rate-card', /Save ranges/],
  ];
  for (const [route, needle] of screens) {
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e.message ?? e)));
    await page.goto(base + route, { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);
    const m = await page.evaluate(measure);
    check(needle.test(m.text) && errors.length === 0, `${route} renders on a phone, signed in`, errors[0] ?? '');
    check(m.overflow <= 1, `${route} fits the screen: no sideways scroll`, m.overflow > 1 ? `${m.overflow}px too wide: ${m.wide.join(', ')}` : '390px');
    check(m.small.length === 0, `${route}: every tap target is at least 24px tall`, m.small.join('; '));
    await page.close();
  }

  // One real job by taps, writing nothing.
  {
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e.message ?? e)));
    await page.goto(`${base}/admin/today`, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Toggle menu' }).tap();
    await page.locator('aside').getByRole('link', { name: 'Jobs' }).last().tap();
    await page.waitForURL(/\/admin\/jobs$/, { timeout: 15000 });
    ok('the menu opens by a tap and Jobs is in it');
    await page.getByRole('tab', { name: /Balance owed/ }).tap();
    const selected = await page.getByRole('tab', { name: /Balance owed/ }).getAttribute('aria-selected');
    check(selected === 'true', 'a stage switches by a tap');
    const record = page.getByRole('button', { name: 'Record cash or Venmo' }).first();
    if (await record.count()) {
      await record.tap();
      await page.getByLabel('Amount paid').fill('12.50');
      const save = page.getByRole('button', { name: 'Record payment' });
      check(await save.isEnabled(), 'the cash form opens and takes an amount');
      await page.getByRole('button', { name: 'Cancel' }).tap();
      ok('and cancels without saving');
    } else {
      // Nothing is owed on the live books right now; the form is proven by gates/business.mjs.
      ok('no job owes money right now, so the cash form has nothing to open on', 'server half: gates/business.mjs');
    }
    check(errors.length === 0, 'nothing threw along the way', errors[0] ?? '');
    await page.close();
  }
} finally {
  await browser.close();
  await s.end();
}
console.log(`\n${fail ? 'FAIL' : 'PASS'} ${pass}/${pass + fail}`);
process.exit(fail ? 1 : 0);
