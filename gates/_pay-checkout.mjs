/**
 * Pay a Stripe-hosted Checkout page with a test card, for gates that need money to have moved.
 *
 * The same steps gates/checkout-e2e.mjs learned the hard way, in one place: wait for the method
 * chooser (Checkout renders it late on a cold load), choose Card, fill it, untick "save my
 * information" (with it ticked Link demands a phone and Subscribe silently refuses), submit, and
 * wait to leave checkout.stripe.com.
 */
export async function payCheckout(url, { card = '4242424242424242', name = 'Gate Customer', zip = '93001', leaveTo = /^(?!https:\/\/checkout\.stripe\.com)/, screenshot = null } = {}) {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.locator('#cardNumber').or(page.getByTestId('card-accordion-item')).first().waitFor({ timeout: 45000 }).catch(() => {});
    const cardTab = page.getByTestId('card-accordion-item').or(page.getByText(/^Card$/).first());
    if (await cardTab.count().catch(() => 0)) await cardTab.first().click({ timeout: 10000 }).catch(() => {});
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
  } finally {
    await browser.close();
  }
}
