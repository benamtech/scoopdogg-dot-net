// node --test tests/
// The MCP server's promises (server/lib/mcp.ts), each with the case that would break it. The data
// sources are fakes: this tests the contract ChatGPT and OpenAI's reviewers read, not the rows.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleMessage, TOOLS, WIDGET_URI, type McpDeps } from '../server/lib/mcp.ts';
import { WIDGET_HTML } from '../server/lib/mcp-widget.ts';

const leads: Record<string, string | number>[] = [];
const bookings: any[] = [];
const deps: McpDeps = {
  site: 'https://scoopdogg.net',
  widget: WIDGET_HTML,
  snapshot: async () => ({
    services: [
      { slug: 'weekly-pooper-scooper-service', name: 'Weekly Pooper Scooper Service', kind: 'recurring' },
      { slug: 'one-time-dog-poop-cleanup', name: 'One-Time Dog Poop Cleanup', kind: 'one_time' },
    ],
    tiers: [
      { id: 't-std', service_slug: 'one-time-dog-poop-cleanup', label: 'Standard yard', price_cents: 9900, requires_quote: false, price_is_from: false, price_suffix: '' },
      { id: 't-severe', service_slug: 'one-time-dog-poop-cleanup', label: 'Severe', price_cents: null, requires_quote: true, price_is_from: false, price_suffix: '' },
    ],
    packages: [2, 1].map((n) => ({ id: `pkg-${n}`, slug: `scoop-weekly-${n}`, service_slug: 'weekly-pooper-scooper-service', name: `Weekly · ${n} dog`, monthly_price_cents: 9000 + n * 1000 })),
    areas: [{ name: 'Oxnard' }],
    settings: { 'business.name': 'Scoop Dogg', 'business.phone': '(805) 555-0100', 'quote.reply_promise': 'Josue replies the same day.' },
  }),
  resolveZip: async (zip) => (zip === '93030' ? { known: true, served: true, area_name: 'Oxnard' } : { known: false, served: false }),
  price: async (_zip, sel) => sel.tier_id
    ? { area: 'Oxnard', monthly_cents: null, first_charge_cents: 9900, discount_cents: 0, offers: [], dates: [{ date: '2026-10-06', label: 'Tuesday 6 October' }] }
    : { area: 'Oxnard', monthly_cents: 11000, first_charge_cents: 5500, discount_cents: 5500, offers: ['First month half off'], dates: [{ date: '2026-10-06', label: 'Tuesday 6 October' }] },
  book: async (b) => { if (b.start_date === '2026-01-01') throw { userMessage: 'That day just filled up. Please pick another.' }; bookings.push(b); return { booking_id: 'sub-1', start_label: 'Tuesday 6 October' }; },
  submitLead: async (lead) => { leads.push(lead); return { ok: true }; },
};
const rpc = (method: string, params?: unknown, id: number | undefined = 1) => handleMessage(deps, { jsonrpc: '2.0', id, method, params });
const call = async (name: string, args: unknown) => (await rpc('tools/call', { name, arguments: args }))!.result;

test('initialize answers the protocol version the client asked for, when it is one we speak', async () => {
  const r = (await rpc('initialize', { protocolVersion: '2025-06-18' }))!.result;
  assert.equal(r.protocolVersion, '2025-06-18');
  assert.deepEqual(Object.keys(r.capabilities).sort(), ['resources', 'tools']);
});

test('a notification gets no answer (the handler returns 202)', async () => {
  assert.equal(await handleMessage(deps, { jsonrpc: '2.0', method: 'notifications/initialized' }), null);
});

test('every tool carries all three annotations as explicit booleans (OpenAI review rejects omissions)', () => {
  for (const t of TOOLS) for (const k of ['readOnlyHint', 'destructiveHint', 'openWorldHint'] as const) {
    assert.equal(typeof (t.annotations as any)[k], 'boolean', `${t.name}.${k}`);
  }
  // The only writes are the booking and the request, and both are additive.
  assert.deepEqual(TOOLS.filter((t) => !t.annotations.readOnlyHint).map((t) => t.name).sort(), ['book_start_day', 'submit_service_request']);
  for (const t of TOOLS) assert.equal(t.annotations.destructiveHint, false, t.name);
});

test('request_service is the Get Quote launcher: its name, its widget URI, and business_id', () => {
  const t = TOOLS.find((x) => x.name === 'request_service')!;
  assert.equal((t._meta as any).ui.resourceUri, 'ui://widget/request-service.html');
  assert.ok('business_id' in (t.inputSchema as any).properties);
});

test('the widget is served as an MCP App and loads nothing from the network', async () => {
  const c = (await rpc('resources/read', { uri: WIDGET_URI }))!.result.contents[0];
  assert.equal(c.mimeType, 'text/html;profile=mcp-app');
  assert.doesNotMatch(c.text, /(src|href)="https?:/);
});

test('NOTHING links to checkout: no /book, no stripe, no checkout URL in any result or the widget', async () => {
  const outputs = [
    WIDGET_HTML,
    JSON.stringify(await call('list_services', {})),
    JSON.stringify(await call('get_price_and_start_days', { postal_code: '93030', dogs: 2 })),
    JSON.stringify(await call('book_start_day', { name: 'Ana Cruz', phone: '8055550100', email: 'a@example.com', address: '1 Elm St', postal_code: '93030', start_date: '2026-10-06', dogs: 1, last_cleaned: 'this_week' })),
    JSON.stringify(await call('request_service', { postal_code: '93030' })),
    JSON.stringify(await call('submit_service_request', { name: 'T', phone: '8055550100', email: 't@example.com', postal_code: '93030', service: 'weekly', dogs: 1 })),
  ];
  for (const o of outputs) assert.doesNotMatch(o, /\/book\b|checkout|stripe\.com/i);
});

test('the quote is the site\'s figure, with the offer, and dogs pick the package by price order', async () => {
  const q = await call('get_price_and_start_days', { postal_code: '93030', dogs: 2 });
  assert.equal(q.structuredContent.per_month, '$110');
  assert.equal(q.structuredContent.first_charge, '$55');
  assert.equal(q.structuredContent.plan, 'Weekly · 2 dog');
  assert.deepEqual(q.structuredContent.start_days, [{ date: '2026-10-06', label: 'Tuesday 6 October' }]);
});

test('a one-time tier is priced once, and a quote-only tier is sent to a request instead of priced', async () => {
  assert.equal((await call('get_price_and_start_days', { postal_code: '93030', tier_id: 't-std' })).structuredContent.first_charge, '$99');
  assert.equal((await call('get_price_and_start_days', { postal_code: '93030', tier_id: 't-severe' })).structuredContent.needs_quote, true);
  assert.equal((await call('book_start_day', { name: 'Ana Cruz', phone: '8055550100', email: 'a@example.com', address: '1 Elm St', postal_code: '93030', start_date: '2026-10-06', tier_id: 't-severe' })).isError, true);
});

test('a weekly booking carries the package for the dogs and the last-cleaned answer, and charges nothing', async () => {
  const before = bookings.length;
  const r = await call('book_start_day', { name: 'Ana Cruz', phone: '8055550100', email: 'a@example.com', address: '1 Elm St', postal_code: '93030', start_date: '2026-10-06', dogs: 2, last_cleaned: 'longer' });
  assert.equal(r.structuredContent.booked, true);
  assert.equal(bookings.length, before + 1);
  assert.equal(bookings.at(-1).package_id, 'pkg-2');
  assert.equal(bookings.at(-1).last_cleaned, 'longer');
  assert.match(r.content[0].text, /Nothing has been charged/);
});

test('a weekly booking without the last-cleaned answer is refused: a yard that is behind owes a catch-up visit', async () => {
  const before = bookings.length;
  assert.equal((await call('book_start_day', { name: 'Ana Cruz', phone: '8055550100', email: 'a@example.com', address: '1 Elm St', postal_code: '93030', start_date: '2026-10-06', dogs: 1 })).isError, true);
  assert.equal(bookings.length, before);
});

test('the site\'s own refusal reaches the person in its own words', async () => {
  const r = await call('book_start_day', { name: 'Ana Cruz', phone: '8055550100', email: 'a@example.com', address: '1 Elm St', postal_code: '93030', start_date: '2026-01-01', dogs: 1, last_cleaned: 'this_week' });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /filled up/);
});

test('an unserved ZIP gets no price and no request', async () => {
  assert.equal((await call('get_price_and_start_days', { postal_code: '10001', dogs: 1 })).structuredContent.served, false);
  const before = leads.length;
  assert.equal((await call('submit_service_request', { name: 'T', phone: '8055550100', email: 't@example.com', postal_code: '10001', service: 'weekly' })).isError, true);
  assert.equal(leads.length, before);
});

test('a request becomes one lead through the site\'s lead path, marked as from ChatGPT', async () => {
  const before = leads.length;
  const r = await call('submit_service_request', { name: 'Ana', phone: '8055550100', email: 'ana@example.com', postal_code: '93030', service: 'one-time', notes: 'gate 1234' });
  assert.equal(r.structuredContent.sent, true);
  assert.equal(leads.length, before + 1);
  const l = leads.at(-1)!;
  assert.equal(l.source_page, 'chatgpt');
  assert.equal(l.city, 'Oxnard');
  assert.equal(l.service_type, 'one-time-dog-poop-cleanup');
  assert.match(String(l.notes), /gate 1234/);
  assert.match(r.content[0].text, /Nothing has been booked or charged/);
});

test('a request missing contact details is refused before anything is sent', async () => {
  const before = leads.length;
  assert.equal((await call('submit_service_request', { name: 'T', phone: '', email: 'nope', postal_code: '93030', service: 'weekly' })).isError, true);
  assert.equal(leads.length, before);
});

test('an unknown tool is a JSON-RPC error, not a crash', async () => {
  assert.equal((await rpc('tools/call', { name: 'delete_everything', arguments: {} }))!.error.code, -32602);
});
