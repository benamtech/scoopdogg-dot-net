/**
 * Every service in the catalog has a route into the funnel, and the funnel renders them all.
 *
 *   node gates/all-services-bookable.mjs
 *
 * P16 §3 and §10. The funnel booked FOUR of eleven services, and the two biggest tickets in the
 * catalog - the $179 deep clean and the $149 heavy cleanup - were a sentence linking to /contact.
 * That is the top of the funnel narrowed by an implementation detail: the four services with
 * `packages` rows were bookable and the seven without were not, for no reason a customer could
 * see. P19 §4 counts widening it as growth work, because it is.
 *
 * TWO HALVES, AND BOTH ARE NEEDED. The database half asks whether every service CAN be priced.
 * The source half asks whether the funnel actually offers them - a catalog full of bookable
 * services renders nothing if the island still maps over a hardcoded list of four, which is
 * exactly what it did.
 */
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { loadEnv } from '../scripts/_env.mjs';

loadEnv();
let pass = 0, fail = 0;
const ok = (n, m = '') => { console.log(`  PASS  ${n}${m ? ` — ${m}` : ''}`); pass++; };
const no = (n, m = '') => { console.log(`  FAIL  ${n}${m ? ` — ${m}` : ''}`); fail++; };

const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: true } });
await c.connect();
await c.query('begin transaction read only');

// 1. every active service resolves to a shape: a plan, a priced one-time tier, or a quote.
const { rows: services } = await c.query(`
  select s.slug, s.name,
         (select count(*) from packages p where p.service_slug = s.slug and p.status = 'active')::int as packages,
         (select count(*) from service_tiers t where t.service_slug = s.slug and t.price_cents is not null and not t.requires_quote and not t.price_is_from)::int as priced_tiers,
         (select count(*) from service_tiers t where t.service_slug = s.slug)::int as tiers
    from services s where s.status = 'active' order by s.sort_order`);

const shape = (s) => (s.packages > 0 ? 'recurring' : s.priced_tiers > 0 ? 'one_time' : s.tiers > 0 ? 'quote' : 'stranded');
for (const s of services) console.log(`    ${shape(s).padEnd(9)}  ${s.slug}`);

const stranded = services.filter((s) => shape(s) === 'stranded');
stranded.length ? no('every service has a shape', stranded.map((s) => s.slug).join(', '))
                : ok('every service has a shape', `${services.length} services`);

const bookable = services.filter((s) => shape(s) !== 'quote');
bookable.length >= 10
  ? ok('at least ten of the eleven services take money without a conversation', `${bookable.length} of ${services.length}`)
  : no('at least ten of the eleven services take money without a conversation', `${bookable.length} of ${services.length}`);

// 2. A FLOOR IS ALLOWED TO EXIST; IT IS NOT ALLOWED TO BE CHARGED AS A ONE-TIME PRICE.
//
// Josue publishes "From $70" on the largest turf-deodorizing area, and that is a real answer for
// an area nobody has looked at yet. The rule (P16 §10, gates/from-price-never-final.mjs) is that
// such a tier reaches the request lane rather than a checkout, so what matters is that a ONE-TIME
// service carrying one still has a tier somebody can actually pay.
//
// RECURRING SERVICES ARE OUT OF SCOPE HERE, deliberately. weekly-yard-maintenance publishes both
// its per-visit tiers as floors, and its monthly packages are not derived from them: migration
// 016 set them from the $85/hour floor at est_minutes ($300 for a 45-minute yard is $69 a visit,
// which is where the "From $70" came from in the first place). Whether $300 a month is firm for
// any yard a customer calls small is a question for Josue, not an invariant this gate can assert.
{
  const { rows } = await c.query(`
    select s.slug, count(*) filter (where t.price_is_from)::int as floors,
           count(*) filter (where t.price_cents is not null and not t.requires_quote and not t.price_is_from)::int as real_prices
      from services s join service_tiers t on t.service_slug = s.slug
     where s.status = 'active'
       and not exists (select 1 from packages p where p.service_slug = s.slug and p.status = 'active')
     group by s.slug having count(*) filter (where t.price_is_from) > 0`);
  const trapped = rows.filter((r) => r.real_prices === 0);
  trapped.length
    ? no('a one-time service with a "from" price still has a price somebody can pay', trapped.map((r) => r.slug).join(', '))
    : ok('a one-time service with a "from" price still has a price somebody can pay',
         rows.length ? rows.map((r) => `${r.slug}: ${r.floors} floor, ${r.real_prices} priced`).join('; ') : 'no floors on one-time services');
}

await c.query('rollback');
await c.end();

// 3. THE FUNNEL RENDERS FROM THE CATALOG, not from a list typed into the island.
{
  const flow = readFileSync('src/components/booking/BookingFlow.tsx', 'utf8');
  const derivesShapes = /bookableServices\(catalog\)/.test(flow) && /shapes\.map\(/.test(flow);
  derivesShapes ? ok('the service step maps over the catalog, not over a constant')
                : no('the service step maps over the catalog, not over a constant');

  // The old constant, by name and by shape. Either would silently narrow the funnel again.
  const hardcoded = /const RECURRING\s*=\s*\[/.test(flow);
  hardcoded ? no('no hardcoded list of bookable services in the island', 'RECURRING is back')
            : ok('no hardcoded list of bookable services in the island');

  // A floor must reach the request lane, never a checkout, in the island too.
  const floorToQuote = /quoteOnly = p\.kind !== 'price'/.test(flow);
  floorToQuote ? ok('a "from" price is offered as a quote in the funnel, never as a price')
               : no('a "from" price is offered as a quote in the funnel, never as a price');

  const oneTimePath = /tier_id/.test(flow) && /quoteOneTime\(/.test(flow);
  oneTimePath ? ok('the island can book a one-time tier, not just a package')
              : no('the island can book a one-time tier, not just a package');

  // Negative controls: both detectors must be able to go red.
  /const RECURRING\s*=\s*\[/.test('const RECURRING = [\n]') ? ok('negative control: a reinstated constant trips it')
    : no('negative control: a reinstated constant trips it', 'DETECTOR BLIND');
  /bookableServices\(catalog\)/.test('const shapes = useMemo(() => [], [])')
    ? no('negative control: an island that stops deriving shapes trips it', 'DETECTOR BLIND')
    : ok('negative control: an island that stops deriving shapes trips it');
}

// 4. the server can price a one-time job at all.
{
  const booking = readFileSync('server/lib/booking.ts', 'utf8');
  /chargeOnce\(/.test(booking) ? ok('the server charges a one-time job through money.ts')
                              : no('the server charges a one-time job through money.ts');
  /frequency = 'one_time'|'one_time'/.test(booking) ? ok('a one-time job is a subscriptions row with one visit')
                                                    : no('a one-time job is a subscriptions row with one visit');
}

console.log(fail ? `FAIL ${fail} of ${pass + fail}` : `PASS ${pass}/${pass}`);
process.exit(fail ? 1 : 0);
