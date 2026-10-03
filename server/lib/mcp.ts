/**
 * Scoop Dogg as an MCP server: what ChatGPT, Claude or any agent can do with the business directly.
 *
 *   POST /mcp   (vercel.json rewrites it to api/mcp.ts)
 *
 * WHY IT IS WRITTEN BY HAND. The streamable HTTP transport lets a server answer each POST with one
 * JSON body, and a stateless server needs only initialize, tools/*, resources/* and ping. That is
 * less code than the SDK's glue, and it adds no dependency to a client site (D53).
 *
 * EVERY FACT COMES FROM THE ROWS. Prices, plans, areas, the phone number and the start days are read
 * through the same functions the pages and the booking journey use, so ChatGPT quotes what the site
 * charges and Josue's admin edits reach it the same minute.
 *
 * NO MONEY MOVES THROUGH HERE, AND NOTHING LINKS TO CHECKOUT. ChatGPT plugins may sell physical goods
 * only ("Commerce and monetization", the plugin guidelines, read 2026-10-03). So `book_start_day`
 * makes a REAL booking on the chosen day through createBooking's request path (channel 'chatgpt':
 * no card, no charge), and Josue confirms it, then sends the billing invite or takes payment on the
 * day. `submit_service_request` is the lighter door for a question or a custom quote: a lead
 * through /api/lead. `tests/mcp.test.ts` fails if any result or the widget carries a checkout link.
 *
 * NAMES FOLLOW OPENAI'S LOCAL-SERVICES "GET QUOTE" CONTRACT: `request_service` opens
 * `ui://widget/request-service.html` and accepts `business_id`, so the same server fits the partner
 * programme if AMTECH is admitted to it.
 */
export const WIDGET_URI = 'ui://widget/request-service.html';
const PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26'];

/** What the server needs from the site. api/mcp.ts wires the real ones; the test wires fakes. */
export type McpDeps = {
  snapshot: () => Promise<{
    services: any[]; tiers: any[]; packages: any[]; areas: any[]; settings: Record<string, unknown>;
  }>;
  resolveZip: (zip: string) => Promise<{ known: boolean; served: boolean; area_name?: string; city_name?: string; area_slug?: string | null }>;
  /** The site's own price and start days for a weekly package or a one-time tier at a ZIP. */
  price: (zip: string, sel: { package_id?: string; tier_id?: string }) => Promise<{
    area: string; monthly_cents: number | null; first_charge_cents: number; discount_cents: number; offers: string[];
    dates: { date: string; label: string }[];
  }>;
  /** createBooking with channel 'chatgpt'. Throws a BookingError-like { userMessage } on refusal. */
  book: (b: {
    name: string; phone: string; email: string; address: string; postal_code: string; start_date: string;
    package_id?: string; tier_id?: string; last_cleaned?: string | null; gate_code?: string; notes?: string;
  }) => Promise<{ booking_id: string; start_label: string }>;
  submitLead: (lead: Record<string, string | number>) => Promise<{ ok: boolean; message?: string }>;
  site: string;
  /** The booking card's HTML (server/lib/mcp-widget.ts), passed in so this file imports nothing. */
  widget: string;
};

type Json = Record<string, any>;
type ToolResult = { content: { type: 'text'; text: string }[]; structuredContent?: Json; isError?: boolean };

const dollars = (c: number | null | undefined) => (c == null ? null : `$${(c / 100).toFixed(c % 100 ? 2 : 0)}`);
const ZIP = { type: 'string', pattern: '^\\d{5}$', description: '5-digit ZIP code, e.g. 91360' };
const READ = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };

const weeklyPlans = (s: Awaited<ReturnType<McpDeps['snapshot']>>) =>
  s.packages.filter((p) => p.service_slug === 'weekly-pooper-scooper-service')
    .sort((a, b) => a.monthly_price_cents - b.monthly_price_cents);

function serviceView(s: Awaited<ReturnType<McpDeps['snapshot']>>, svc: any, site: string) {
  return {
    slug: svc.slug, name: svc.name, kind: svc.kind,
    monthly_plans: s.packages.filter((p) => p.service_slug === svc.slug)
      .map((p) => ({ package: p.slug, label: p.name, per_month: dollars(p.monthly_price_cents) })),
    prices: s.tiers.filter((t) => t.service_slug === svc.slug)
      .map((t) => ({ tier_id: t.id, label: t.label, price: t.requires_quote ? 'custom quote' : `${t.price_is_from ? 'from ' : ''}${dollars(t.price_cents)}${t.price_suffix || ''}` })),
    page: `${site}/services/${svc.slug}`,
  };
}

const LAST_CLEANED_KEYS = ['this_week', 'two_weeks', 'month', 'longer'];

export const TOOLS = [
  {
    name: 'check_service_area',
    title: 'Check a ZIP code',
    description: 'Use this when someone asks whether Scoop Dogg (dog poop pickup and yard care in Ventura and Santa Barbara counties, California) comes to their address. Takes a 5-digit ZIP code and says whether it is served, and the city. Do not use for places outside California.',
    inputSchema: { type: 'object', properties: { postal_code: ZIP }, required: ['postal_code'], additionalProperties: false },
    annotations: READ,
    _meta: { 'openai/widgetAccessible': true, 'openai/toolInvocation/invoking': 'Checking the ZIP…', 'openai/toolInvocation/invoked': 'Checked' },
  },
  {
    name: 'list_services',
    title: 'Services and prices',
    description: 'Use this when someone asks what Scoop Dogg does or what it costs: weekly dog poop scooping, one-time yard cleanups, artificial turf deodorizing, turf and yard maintenance, kitty litter exchange. Returns each service with its current prices, plan and tier ids, and the towns served. Optional `service` narrows it to one service slug.',
    inputSchema: { type: 'object', properties: { service: { type: 'string', description: 'A service slug, e.g. weekly-pooper-scooper-service' } }, additionalProperties: false },
    annotations: READ,
    _meta: { 'openai/widgetAccessible': true },
  },
  {
    name: 'get_price_and_start_days',
    title: 'Price and start days',
    description: "Use this when someone wants the price of weekly dog poop pickup or a one-time yard cleanup at their address, or the days Scoop Dogg can start. Takes a ZIP code and either `dogs` (weekly plan, 1-4; 4 means four or more) or `tier_id` (a one-time cleanup tier from list_services). Returns Scoop Dogg's own price, the first charge after any offer, and the start days that are open. It does not book anything.",
    inputSchema: {
      type: 'object',
      properties: { postal_code: ZIP, dogs: { type: 'integer', minimum: 1, maximum: 4 }, tier_id: { type: 'string', description: 'One-time cleanup tier id from list_services' } },
      required: ['postal_code'], additionalProperties: false,
    },
    annotations: READ,
    _meta: { 'openai/widgetAccessible': true, 'openai/toolInvocation/invoking': 'Pricing…', 'openai/toolInvocation/invoked': 'Priced' },
  },
  {
    name: 'request_service',
    title: 'Book Scoop Dogg',
    description: 'Use this when someone wants to book or get a quote from Scoop Dogg for dog poop pickup or a one-time yard cleanup in Ventura or Santa Barbara counties. Opens a card where they check their ZIP, choose the service, see the real price and pick a start day. Pass whatever is already known; the card asks for the rest.',
    inputSchema: {
      type: 'object',
      properties: {
        business_id: { type: 'string', description: 'Provider business id, sent by Get Quote launches' },
        postal_code: ZIP,
        dogs: { type: 'integer', minimum: 1, maximum: 4 },
        service: { type: 'string', enum: ['weekly', 'one-time'], description: 'Weekly plan or a one-time cleanup' },
      },
      additionalProperties: false,
    },
    annotations: READ,
    _meta: { ui: { resourceUri: WIDGET_URI }, 'openai/outputTemplate': WIDGET_URI, 'openai/toolInvocation/invoking': 'Opening the booking card…', 'openai/toolInvocation/invoked': 'Booking card ready' },
  },
  {
    name: 'book_start_day',
    title: 'Book a start day',
    description: "Use this when someone has chosen a start day from get_price_and_start_days and given their name, phone, email and service address. Books that day with Scoop Dogg without taking any payment; Scoop Dogg confirms with them and they pay on scoopdogg.net or on the day. Takes `dogs` for a weekly plan (with `last_cleaned`) or `tier_id` for a one-time cleanup. Only send details the person typed for this booking.",
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', minLength: 2, maxLength: 120 },
        phone: { type: 'string', minLength: 10, maxLength: 40 },
        email: { type: 'string', format: 'email', maxLength: 200 },
        address: { type: 'string', minLength: 5, maxLength: 300, description: 'Street address where the service happens' },
        postal_code: ZIP,
        start_date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'A start day returned by get_price_and_start_days' },
        dogs: { type: 'integer', minimum: 1, maximum: 4 },
        last_cleaned: { type: 'string', enum: LAST_CLEANED_KEYS, description: 'When the yard was last cleaned: this_week, two_weeks, month (3-6 weeks), longer' },
        tier_id: { type: 'string', description: 'One-time cleanup tier id' },
        gate_code: { type: 'string', maxLength: 60 },
        notes: { type: 'string', maxLength: 1000, description: 'Access notes or dog names' },
      },
      required: ['name', 'phone', 'email', 'address', 'postal_code', 'start_date'],
      additionalProperties: false,
    },
    // Adds one booking and changes nothing else: not read-only, not destructive, bounded to Scoop Dogg.
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    _meta: { 'openai/widgetAccessible': true, 'openai/toolInvocation/invoking': 'Booking…', 'openai/toolInvocation/invoked': 'Booked' },
  },
  {
    name: 'submit_service_request',
    title: 'Ask Scoop Dogg',
    description: "Use this when someone wants Scoop Dogg to contact them instead of booking a day now: a question, a yard that needs a custom quote, or a service not priced online. Takes their name, phone, email, ZIP and what they need. Scoop Dogg replies to them directly. It does not book or charge anything.",
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', minLength: 1, maxLength: 120 },
        phone: { type: 'string', minLength: 7, maxLength: 40 },
        email: { type: 'string', format: 'email', maxLength: 200 },
        postal_code: ZIP,
        service: { type: 'string', enum: ['weekly', 'one-time', 'other'] },
        dogs: { type: 'integer', minimum: 1, maximum: 4 },
        notes: { type: 'string', maxLength: 1000, description: 'What they need' },
      },
      required: ['name', 'phone', 'email', 'postal_code', 'service'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    _meta: { 'openai/widgetAccessible': true, 'openai/toolInvocation/invoking': 'Sending…', 'openai/toolInvocation/invoked': 'Sent' },
  },
] as const;

const text = (t: string, sc?: Json): ToolResult => ({ content: [{ type: 'text', text: t }], ...(sc ? { structuredContent: sc } : {}) });
const fail = (t: string): ToolResult => ({ content: [{ type: 'text', text: t }], isError: true });
const isZip = (z: unknown): z is string => typeof z === 'string' && /^\d{5}$/.test(z);
const plural = (n: number) => `${n === 4 ? '4+' : n} dog${n > 1 ? 's' : ''}`;

export async function callTool(deps: McpDeps, name: string, a: Json): Promise<ToolResult> {
  const snap = () => deps.snapshot();
  const phone = async () => String((await snap()).settings['business.phone'] ?? '');
  switch (name) {
    case 'check_service_area': {
      if (!isZip(a.postal_code)) return fail('Please give a 5-digit ZIP code.');
      const z = await deps.resolveZip(a.postal_code);
      const t = z.served ? `Yes, Scoop Dogg comes to ${a.postal_code} (${z.area_name}).`
        : z.known ? `${a.postal_code} (${z.city_name}) is not on a route yet.` : `${a.postal_code} is outside Scoop Dogg's service area.`;
      return text(t, { postal_code: a.postal_code, served: !!z.served, known: !!z.known, area: z.area_name ?? null });
    }
    case 'list_services': {
      const s = await snap();
      const list = s.services.filter((v) => !a.service || v.slug === a.service).map((v) => serviceView(s, v, deps.site));
      if (!list.length) return fail(`No service called ${a.service}.`);
      const areas = s.areas.map((x) => x.name);
      const lines = list.map((v) => `${v.name}: ${[...v.monthly_plans.map((p) => `${p.label} ${p.per_month}/month`), ...v.prices.map((p) => `${p.label} ${p.price}`)].join('; ')}`);
      return text(`${lines.join('\n')}\nServes: ${areas.join(', ')}. Phone ${s.settings['business.phone']}.`, { services: list, areas, phone: s.settings['business.phone'], site: deps.site });
    }
    case 'get_price_and_start_days': {
      if (!isZip(a.postal_code)) return fail('Please give a 5-digit ZIP code.');
      const s = await snap();
      let sel: { package_id?: string; tier_id?: string }; let label: string;
      if (a.tier_id) {
        const t = s.tiers.find((x) => x.id === a.tier_id && x.service_slug === 'one-time-dog-poop-cleanup');
        if (!t) return fail('That cleanup option was not found. Use a tier id from list_services.');
        if (t.requires_quote) return text(`${t.label} needs a quick look first, so it has no online price. Use submit_service_request and Scoop Dogg will quote it.`, { postal_code: a.postal_code, needs_quote: true });
        sel = { tier_id: t.id }; label = `One-time cleanup · ${t.label}`;
      } else {
        const dogs = Number(a.dogs || 1);
        const pkg = weeklyPlans(s)[dogs - 1];
        if (!pkg) return fail('Choose 1 to 4 dogs (4 means four or more).');
        sel = { package_id: pkg.id }; label = pkg.name;
      }
      const z = await deps.resolveZip(a.postal_code);
      if (!z.served) return text(`${a.postal_code} is not on a Scoop Dogg route, so there is no price for it. Call ${await phone()} to ask.`, { postal_code: a.postal_code, served: false });
      const p = await deps.price(a.postal_code, sel);
      const out = {
        postal_code: a.postal_code, served: true, area: p.area, plan: label,
        per_month: dollars(p.monthly_cents), first_charge: dollars(p.first_charge_cents), discount: dollars(p.discount_cents),
        offers: p.offers, start_days: p.dates,
      };
      const price = p.monthly_cents != null
        ? `${out.per_month}/month${p.discount_cents > 0 ? `, first charge ${out.first_charge} after ${out.discount} off${p.offers.length ? ` (${p.offers.join(', ')})` : ''}` : ''}`
        : out.first_charge;
      return text(`${label} in ${p.area}: ${price}. Open start days: ${p.dates.map((d) => `${d.label} (${d.date})`).join(', ') || 'none online; call to arrange'}.`, out);
    }
    case 'request_service': {
      const s = await snap();
      const oneTime = s.services.find((v) => v.slug === 'one-time-dog-poop-cleanup');
      return text('Showing the Scoop Dogg booking card.', {
        business: s.settings['business.name'] || 'Scoop Dogg',
        phone: s.settings['business.phone'],
        guarantee: s.settings['trust.guarantee_text'] || null,
        reply_promise: s.settings['quote.reply_promise'] || null,
        prefill: { postal_code: isZip(a.postal_code) ? a.postal_code : null, dogs: a.dogs ?? null, service: a.service === 'one-time' ? 'one-time' : 'weekly' },
        weekly: weeklyPlans(s).map((p, i) => ({ dogs: i + 1, label: p.name, per_month: dollars(p.monthly_price_cents) })),
        one_time: oneTime ? s.tiers.filter((t) => t.service_slug === oneTime.slug)
          .map((t) => ({ tier_id: t.id, label: t.label, price: t.requires_quote ? 'custom quote' : `${t.price_is_from ? 'from ' : ''}${dollars(t.price_cents)}`, needs_quote: !!t.requires_quote })) : [],
        last_cleaned: [['this_week', 'This week'], ['two_weeks', '1–2 weeks ago'], ['month', '3–6 weeks ago'], ['longer', 'Longer than that']].map(([key, label]) => ({ key, label })),
        site: deps.site,
      });
    }
    case 'book_start_day': {
      const need = ['name', 'phone', 'email', 'address', 'postal_code', 'start_date'].filter((k) => !String(a[k] ?? '').trim());
      if (need.length) return fail(`A booking needs ${need.join(', ')}.`);
      if (!isZip(a.postal_code)) return fail('Please give a 5-digit ZIP code.');
      const s = await snap();
      let sel: { package_id?: string; tier_id?: string }; let label: string;
      if (a.tier_id) {
        const t = s.tiers.find((x) => x.id === a.tier_id && x.service_slug === 'one-time-dog-poop-cleanup');
        if (!t || t.requires_quote) return fail('That cleanup needs a quote first. Use submit_service_request.');
        sel = { tier_id: t.id }; label = `a one-time cleanup (${t.label})`;
      } else {
        const dogs = Number(a.dogs || 0);
        const pkg = weeklyPlans(s)[dogs - 1];
        if (!pkg) return fail('Say how many dogs (1 to 4) for a weekly plan, or choose a one-time cleanup.');
        if (!LAST_CLEANED_KEYS.includes(a.last_cleaned)) return fail('Ask when the yard was last cleaned (this_week, two_weeks, month or longer): a yard that is behind needs a catch-up first visit.');
        sel = { package_id: pkg.id }; label = `weekly pickup for ${plural(dogs)}`;
      }
      const z = await deps.resolveZip(a.postal_code);
      if (!z.served) return fail(`${a.postal_code} is not on a Scoop Dogg route yet. Call ${await phone()} to ask.`);
      try {
        const r = await deps.book({
          name: a.name, phone: a.phone, email: a.email, address: a.address, postal_code: a.postal_code, start_date: a.start_date,
          ...sel, last_cleaned: a.last_cleaned ?? null, gate_code: a.gate_code, notes: a.notes,
        });
        return text(`Booked: ${label} starting ${r.start_label}, in ${z.area_name}. Nothing has been charged. Scoop Dogg will confirm with you, then you pay on scoopdogg.net or on the day.`, { booked: true, start: r.start_label, area: z.area_name });
      } catch (e: any) {
        return fail(e?.userMessage || `That booking did not go through. Call ${await phone()}.`);
      }
    }
    case 'submit_service_request': {
      const name = String(a.name ?? '').trim(), phoneIn = String(a.phone ?? '').trim(), email = String(a.email ?? '').trim();
      if (!name || !phoneIn || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !isZip(a.postal_code)) return fail('A request needs a name, phone, email and 5-digit ZIP code.');
      const z = await deps.resolveZip(a.postal_code);
      if (!z.served) return fail(`${a.postal_code} is not on a Scoop Dogg route yet, so a request cannot be sent. Call ${await phone()} to ask.`);
      const service = a.service === 'one-time' ? 'one-time-dog-poop-cleanup' : a.service === 'weekly' ? 'weekly-pooper-scooper-service' : 'other';
      const dogs = Number(a.dogs) || 0;
      const r = await deps.submitLead({
        name, phone: phoneIn, email, city: String(z.area_name ?? z.city_name ?? ''), address: '',
        service_type: service, num_dogs: dogs,
        notes: [`Sent from ChatGPT. ZIP ${a.postal_code}.`, dogs ? `${plural(dogs)}.` : '', String(a.notes ?? '').trim()].filter(Boolean).join(' '),
        source_page: 'chatgpt',
      });
      if (!r.ok) return fail(r.message || `The request could not be sent just now. Call ${await phone()}.`);
      const promise = String((await snap()).settings['quote.reply_promise'] ?? '').trim();
      return text(`Request sent to Scoop Dogg for ${z.area_name}. ${promise || 'Scoop Dogg will contact you.'} Nothing has been booked or charged.`, { sent: true, area: z.area_name });
    }
    default:
      return fail(`Unknown tool ${name}.`);
  }
}

/** One JSON-RPC message in, one response out (null for a notification). */
export async function handleMessage(deps: McpDeps, m: Json): Promise<Json | null> {
  const reply = (result: Json) => ({ jsonrpc: '2.0', id: m.id, result });
  const error = (code: number, message: string) => ({ jsonrpc: '2.0', id: m.id ?? null, error: { code, message } });
  if (!m || m.jsonrpc !== '2.0' || typeof m.method !== 'string') return error(-32600, 'Invalid request');
  if (m.id === undefined) return null; // notifications (initialized, cancelled) need no answer
  switch (m.method) {
    case 'initialize': {
      const asked = m.params?.protocolVersion;
      return reply({
        protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
        capabilities: { tools: {}, resources: {} },
        serverInfo: { name: 'scoop-dogg', title: 'Scoop Dogg', version: '1.0.0' },
        instructions: 'Scoop Dogg is a locally owned dog poop pickup and yard care company in Ventura and Santa Barbara counties, California. Check the ZIP before quoting. Prices come only from these tools.',
      });
    }
    case 'ping': return reply({});
    case 'tools/list': return reply({ tools: TOOLS });
    case 'tools/call': {
      const tool = TOOLS.find((t) => t.name === m.params?.name);
      if (!tool) return error(-32602, `Unknown tool ${m.params?.name}`);
      try { return reply(await callTool(deps, tool.name, m.params?.arguments ?? {})); }
      catch { return reply(fail('Something went wrong on our side. Please try again, or call (805) 869-8070.')); }
    }
    case 'resources/list':
      return reply({ resources: [{ uri: WIDGET_URI, name: 'request-service-widget', title: 'Scoop Dogg booking card', mimeType: 'text/html;profile=mcp-app' }] });
    case 'resources/templates/list': return reply({ resourceTemplates: [] });
    case 'resources/read':
      if (m.params?.uri !== WIDGET_URI) return error(-32602, 'Unknown resource');
      return reply({
        contents: [{
          uri: WIDGET_URI, mimeType: 'text/html;profile=mcp-app', text: deps.widget,
          _meta: { ui: { prefersBorder: true, csp: { connectDomains: [], resourceDomains: [] } }, 'openai/widgetDescription': 'A booking card: check the ZIP, choose the service, see the price and open start days, and book a day without paying in ChatGPT.' },
        }],
      });
    default:
      return error(-32601, `Method not found: ${m.method}`);
  }
}
