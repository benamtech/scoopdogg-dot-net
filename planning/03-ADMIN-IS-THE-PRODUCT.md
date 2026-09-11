# The admin is a specialised CMS, and it is where the business grows

Ben, 2026-09-10:

> *"most of the 'big-ness' will come from the admin naturally building out with more team
> members, offers, higher prices, whatever etc etc"*
>
> *"make sure everything like that can be set through the admin dashboard and is
> integrated with stripe. this is sort of like a specialized cms"*

That is an architecture instruction, not a feature request. It means **every dimension
the business can grow along has to be a row somebody adds, never a line of code and a
deploy.** Today all eleven services, all sixteen cities and every single price live in
TypeScript arrays inside a shipped bundle. Raising a price is a pull request. That is the
constraint that compounds fastest as he grows, and removing it is most of the value here.

## The test this design has to pass

Josue should be able to do all of this on a Tuesday, alone, without us:

- Raise weekly scooping from $15 to $18 — **and every existing customer keeps $15**
- Add "gutter cleaning" with three price tiers and have a page exist for it
- Open Santa Clarita: add the city, publish its page, decide separately whether it is bookable yet
- Hire someone, text them a link, have them running a route that afternoon
- Run "first month half off" as a real offer with a redemption count, not a sentence
- Connect Stripe — his existing account or a new one — and start taking cards
- Turn off deposits, change the skip policy, change what a completion text says

None of those is a deploy. All of them are rows.

## What is editable, and what it drives

| Admin screen | Table | What changes on the public site |
|---|---|---|
| Services | `services`, `service_tiers` | A service page, its rate card, the booking form's question, the sitemap |
| Areas | `service_areas`, `service_area_offers` | A city page, the areas index, service×city pages, what is bookable |
| Offers | `offers`, `offer_redemptions` | Promotional copy, and what a quote actually deducts |
| Articles | `articles` | The resource pages |
| Reviews | `reviews` | The reviews page and the homepage strip |
| Team | `team_members` | Nothing public. Who can log in and be assigned work |
| Settings | `settings` | Policy everywhere: deposits, skips, notice periods, notification text |
| Stripe | `stripe_connection` | Whether the site can take money at all |

**Retire, never delete.** A retired service keeps resolving because old subscriptions,
invoices and inbound links still point at its slug. The admin offers "retire", and delete
is not on the screen.

## The trap this must not fall into

A CMS that writes to a database while the site renders from committed files **is two
worlds**, and the site keeps serving the old copy while the admin says "published". That
has already happened on an AMTECH site — every check was a sentence somebody wrote rather
than a command somebody ran, and nobody noticed for weeks.

So all three are wired or none:

1. **The build pulls.** `npm run content:pull` is the first step of `npm run build`. It reads the published rows into `content/*.json`. Everything downstream — the HTML, the markdown twins, `llms.txt`, the sitemap, JSON-LD — is already a projection of those files, so this makes every one of them agree by construction.
2. **Publish triggers a rebuild.** A Vercel deploy hook. `content_publishes` records which fired and whether it went live, and the admin says **which of the two happened** — the row is saved, and the deploy is queued, live, or failed. It never prints "published" when nothing can carry the change.
3. **A push script exists**, for a change made in code or to repair a row.

And **never** a client-side fetch overlaying live data on static HTML. That shows people
the new copy and crawlers the old, which for a business whose whole SEO surface is
currently dark would be a worse bug than the one we are fixing.

**Compare meaning, not bytes.** `jsonb` does not preserve key order and hand-formatted
JSON has compact objects that `JSON.stringify` always expands. Canonicalise — sort keys,
drop timestamps — then compare, or pull and push will permanently disagree about whether
the database matches the repo.

## Where Stripe attaches, and the sync we are deliberately not building

**Onboarding is Connect Onboarding for Standard accounts, not OAuth.** Stripe's own
guidance: *"OAuth isn't recommended for new Connect platforms."* AMTECH's platform does
not exist yet, so it is a new one. Standard is also what Ben's requirement forces — it is
the type where the user brings their own account, keeps their own dashboard, and is the
merchant of record. One button in the admin, one hosted flow, and *"the process of
creating a Stripe account is incorporated into our authorization flow — you don't need to
worry about whether or not your users already have accounts."* Existing account or new
one, both land as a connected account under AMTECH at a 4% application fee.

**The rate card is NOT mirrored into Stripe Products and Prices.** This is the decision
that matters and it runs against the obvious instinct:

- **Stripe Price objects are immutable.** Every price edit would create a new Price and require migrating whatever pointed at the old one. Josue is meant to raise prices freely — that is the point of the CMS — so a mirror turns his easiest action into our hardest one.
- **A scooping month is variable.** Four visits or five, a skipped week, an added deep clean, a custom quote. Stripe Subscriptions model a fixed recurring amount; ours is "sum of what actually happened", which is an invoice.
- **Nine of eleven services have a custom-quote tier.** A negotiated per-customer number has no Product to belong to.

So the catalog is the single source of pricing truth and Stripe is the rail: we charge
computed amounts, carry our own ids in `metadata`, and there is no two-way sync to drift.
Recurring billing is our scheduler plus a monthly invoice, not Stripe Subscriptions.

**Stripe capability is probed, never assumed.** `charges_enabled` and `payouts_enabled`
are read from Stripe and stored with the time they were read. Every money verb refuses
visibly when either is false. Onboarding finishing is not the same fact as charging
working.

**And cash does not go away.** Josue is paid in cash and Venmo today. Stripe is being
*added*. `customers.preferred_payment` and `payments.kind = 'manual'` make an offline
payment a first-class record, and the seven existing customers are never forced to enter
a card to keep the service they already have.

## Thinking bigger than the 805

`business.brand_region` defaults to "the 805" and it is a setting, not a constant, because
three of his sixteen cities are already Los Angeles County and the phrase is a brand line
rather than a boundary. More importantly the **structure** is what has to think bigger,
not the copy:

- `service_areas.market` means a second market is a value in a column, not a second codebase. A business opening in Santa Clarita does not need a developer.
- `service_areas.bookable` separates "has a page for search" from "we will drive there", so he can publish ahead of capacity instead of choosing.
- `services.kind` already admits add-ons, so upsells are a row.
- `team_members` has roles and dates, so hiring, promoting and someone leaving are all normal operations rather than data problems.

**This is still one business, not a platform.** Ben was explicit: not a product for
multiple yard maintenance companies. Every table above is Scoop Dogg's. The generality is
in the dimensions Scoop Dogg itself can grow along.

## Availability, now that we know his hours

Josue works **seven days a week, 7am to 5pm**, and the whole crew have their own phones.
That is a wide window and it changes two defaults from the earlier draft:

- `schedule.service_days` = all seven, not Mon–Sat
- `schedule.day_start` = 07:00, `schedule.day_end` = 17:00
- Per-person availability is real, because per-person phones make per-person assignment and per-person completion attribution possible from day one

Ten hours a day, seven days, is roughly seventy service hours a week before a second
crew. That is the capacity the booking calendar should be offering against — and it is
worth saying that route density, not hours, is what will actually cap him.
