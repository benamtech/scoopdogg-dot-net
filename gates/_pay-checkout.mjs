/**
 * Pay a Stripe-hosted Checkout page with a test card, for gates that need money to have moved.
 *
 * The same steps gates/checkout-e2e.mjs learned the hard way, in one place: wait for the method
 * chooser (Checkout renders it late on a cold load), choose Card, fill it, untick "save my
 * information" (with it ticked Link demands a phone and Subscribe silently refuses), submit, and
 * wait to leave checkout.stripe.com.
 */
export async function payCheckout(url, opts = {}) {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    return await payOnPage(page, opts);
  } finally {
    await browser.close();
  }
}

/**
 * Pay the Checkout already open in `page`. Use this when the page carries something the return
 * trip needs — a preview's protection header on its context — or Stripe's redirect back lands on
 * a sign-in wall and the URL never matches.
 */
export async function payOnPage(page, { card = '4242424242424242', name = 'Gate Customer', zip = '93001', leaveTo = /^(?!https:\/\/checkout\.stripe\.com)/, screenshot = null } = {}) {
    await page.locator('#cardNumber').or(page.getByTestId('card-accordion-item')).first().waitFor({ timeout: 45000 }).catch(() => {});
    // SELECT CARD, AND CHECK IT TOOK. Measured 2026-09-30 on live test Checkouts: clicking the item
    // (data-testid card-accordion-item) or forcing its radio opens the card form; the inner button and
    // the "Card" label time out. A single click sometimes lands before the page is interactive, so this
    // clicks, waits for #cardNumber, and tries again up to three times.
    const selectCard = async () => {
      for (let i = 0; i < 3; i++) {
        if (await page.locator('#cardNumber').isVisible().catch(() => false)) return;
        await page.getByTestId('card-accordion-item').click({ timeout: 5000 }).catch(() => {});
        if (await page.locator('#cardNumber').waitFor({ timeout: 5000 }).then(() => true, () => false)) return;
        await page.locator('#payment-method-accordion-item-title-card').click({ force: true, timeout: 5000 }).catch(() => {});
        if (await page.locator('#cardNumber').waitFor({ timeout: 5000 }).then(() => true, () => false)) return;
      }
    };
    await selectCard();
    try {
      await page.locator('#cardNumber').waitFor({ timeout: 30000 });
    } catch (e) {
      if (screenshot) await page.screenshot({ path: screenshot, fullPage: true }).catch(() => {});
      throw e;
    }
    await page.locator('#cardNumber').fill(card);
    await page.locator('#cardExpiry').fill('12 / 34');
    await page.locator('#cardCvc').fill('123');
    await page.locator('#billingName').fill(name);
    const zipField = page.locator('#billingPostalCode');
    if (await zipField.count()) await zipField.fill(zip);
    const saveInfo = page.locator('#enableStripePass');
    if (await saveInfo.count().catch(() => 0)) await saveInfo.uncheck({ timeout: 5000 }).catch(() => {});
    const phone = page.locator('#phoneNumber');
    if (await phone.isVisible().catch(() => false)) await phone.fill('8055550123').catch(() => {});
    await page.locator('button[type=submit]').click();
    await page.waitForURL(leaveTo, { timeout: 60000 });
    return page.url();
}
