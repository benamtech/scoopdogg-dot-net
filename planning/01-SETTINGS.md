# Settings: every question for Josue, answered by default

Ben, 2026-09-10: *"if there are things that are questions for josue, make them into basic
settings if possible."*

That instruction does more work than it looks like. A question blocks a build. A setting
ships with a default and gets changed in an afternoon. So every open question in the plan
is below as a setting, and **every default is sourced** — most of them from Josue's own
website, because those are promises he has already made publicly and is already keeping.

## The three rules that keep this from becoming a headache

**1. A setting is current config. Money is frozen at the moment it is charged.**
Settings are not a temporal database and must not become one. When Josue raises weekly
service from $15 to $18, the setting changes — and every existing subscription keeps the
rate it was sold at because **the rate is copied onto the subscription when it is
created**, and onto the invoice when it is charged. This is the single most important
line in this document. Without it, raising a price silently rewrites history and every
reprinted invoice is wrong.

**2. A setting never silently changes what a customer was promised.**
Changing `subscription.cancel_notice_hours` from 0 to 48 applies to new subscriptions.
Existing ones keep their terms. The admin says so when you change it.

**3. Every setting has a default that works.** There is no setting whose unset state
blocks a booking. If Josue never opens the settings screen, the business runs on what his
website already says.

---

## Business identity

| Setting | Default | Source |
|---|---|---|
| `business.name` | Scoop Dogg | site |
| `business.timezone` | `America/Los_Angeles` | hardcoded in `notify-new-lead` today |
| `business.phone` | (805) 869-8070 | site |
| `business.email` | josue@scoopdogg.net | site |
| `business.region_label` | `Ventura County and nearby` | factual, covers 13 of 16 cities, safe in any sentence |
| `business.brand_region` | `the 805` | researched — see open questions. Headline copy only, never a boundary claim. Josue confirms |

## Service area

| Setting | Default | Source |
|---|---|---|
| `service_area.cities[]` | the 16 cities in `cities.ts` | site |
| `service_area.booking_mode` | `listed_cities_only` | 16 city pages exist and no others |
| `service_area.outside_area_behaviour` | `capture_lead_and_notify` | never turn away a lead; let Josue decide |

## The rate card — 11 services, already written

`pricing.services[]`, seeded verbatim from `services.ts`. Every service is
`{ slug, tiers[], note }` and every tier is `{ label, basis, min, max, price | "quote" }`.
The `basis` is what is being measured — dogs, square feet, litter boxes, units — which is
what makes a booking able to resolve a price by itself.

| Service | Tiers | Top tier |
|---|---|---|
| weekly-pooper-scooper-service | $15 / $20 / $23 / $25 by dogs (1,2,3,4+) | flat at 4+ |
| one-time-dog-poop-cleanup | $99 standard, $149 heavy | **quote** |
| artificial-turf-deodorizing | $20 / $35 by sq ft | **$50+** |
| yard-deep-clean | $99 / $149 by sq ft | **quote** |
| weekly-turf-maintenance | $35 / $50 per visit by sq ft | **quote** |
| weekly-yard-maintenance | from $40 / from $65 per visit | **quote** |
| kitty-litter-exchange | $15 / $22 by boxes | **quote** at 3+ |
| dog-run-cleanups | $49 / $79 by sq ft | **quote** |
| cat-tree-cleaning | $25 / $45 by levels | **quote** |
| pressure-washing | $59 / $99 by sq ft | **quote** |
| kitty-litter-robot-cleaning | $45 / $75 by units | **quote** at 3+ |

**Nine of the eleven have a "custom quote" top tier.** That is not a gap, it is the
design: the booking resolves a price when it can and raises a quote request when it
cannot. `quote.price` is an owner verb for exactly this, and it is the most common thing
Josue will do in the admin.

| Setting | Default | Source |
|---|---|---|
| `pricing.currency` | USD | — |
| `pricing.tax_mode` | `none` | no tax appears anywhere on the site |
| `pricing.quote_required_message` | "We'll confirm your price after a quick look at your yard." | drawn from his own pricing notes |

## Deposits and payment

| Setting | Default | Source |
|---|---|---|
| `billing.deposit_mode` | **`none`** | "**No sign-up fees.**" His own words. Do not default to taking money he has publicly said he does not take |
| `billing.deposit_amount` | 0 | as above |
| `billing.charge_timing` | `after_visit` | matches how a scooping round actually works |
| `billing.card_on_file_required` | `false` for weekly, `true` for one-time over $99 | protects him on the big jobs without changing his weekly promise |
| `billing.offline_methods[]` | `cash`, `venmo` | **how he is paid today.** Stripe is added, not substituted |
| `billing.connect_account_type` | `standard` | forced by the requirement that he can bring an existing Stripe account. See `03-ADMIN-IS-THE-PRODUCT.md` |
| `billing.platform_fee_bps` | **400** (4%) | Ben, 2026-09-10 |
| `billing.stripe_account_id` | `null` | set by Josue in the admin via a Stripe Account Link |
| `billing.invoice_cadence` | `monthly` | a weekly $15 charge is 4 Stripe fees a month; monthly is cheaper for him |

**Note on the deposit.** Ben asked for deposits in v1 and the capability is built. The
*default* is off, because Josue's site says "no sign-up fees" and shipping a deposit he
never agreed to would be the first thing a customer complains about. It is one toggle.

## Scheduling

| Setting | Default | Source |
|---|---|---|
| `schedule.service_days` | **all seven** | Ben, 2026-09-10: he works any day of the week |
| `schedule.day_start` / `day_end` | **07:00 / 17:00** | Ben, 2026-09-10 |
| `schedule.same_day_every_week` | `true` | "**Same day every week.**" This is his core promise and a real constraint on routing |
| `schedule.driver_consistency` | `preferred` | his reviews praise exactly this. `required` once there are enough crew to honour it |
| `schedule.visit_window_hours` | 4 | an arrival window, not a time. Nothing on the site promises a time |
| `schedule.new_customer_start_days` | 3 | "start within a few days, depending on route availability" |
| `schedule.lead_response_hours` | 24 | "confirmed within 24 hours" |

## Visits, and the gate

| Setting | Default | Source |
|---|---|---|
| `visit.require_completion_photo` | **`true`** | his differentiator is proof of care; a photo is that proof and it costs the crew four seconds |
| `visit.completion_notify_channel` | `sms` | "**Same-day text confirmation when complete.**" |
| `visit.skip_charge_policy` | `no_charge` | "No fees for skipping or pausing." |
| `visit.skip_notice_hours` | 0 | "Just let us know in advance" — no number given, so do not invent one |
| `visit.failed_access_policy` | **`no_charge_notify_owner`** | he drove there, so charging is defensible — but nothing on his site warns customers, so charging by default would break a promise he never made. Notify Josue, let him decide, make it a setting he can flip once he has a stated policy |
| `visit.gate_code_visible_to` | `assigned_crew_only` | a gate code is the most sensitive thing in this database |

## Subscription terms

| Setting | Default | Source |
|---|---|---|
| `subscription.min_term_visits` | **0** | "Never [a contract]." |
| `subscription.cancel_notice_hours` | **0** | "Cancel anytime with no questions asked." |
| `subscription.pause_max_weeks` | 12 | no published limit; a generous cap that stops a paused row living forever |
| `subscription.auto_resume_after_pause` | `true` | pausing for vacation should not silently end the service |

## Notifications

| Setting | Default | Source |
|---|---|---|
| `notify.lead_recipients[]` | josue@scoopdogg.net, scoopdogg129@gmail.com | the current edge function |
| `notify.from_address` | leads@mail.amtechleads.com | current, and it authenticates independently of his own SPF |
| `notify.customer_channel_default` | `sms` | it is a phone-first business |
| `notify.on_the_way_enabled` | `true` | Ben's Uber comparison lives or dies on this one |

## Roles

Three, per the brief, plus AMTECH. `superadmin` (AMTECH), `admin` (Josue), `team`.
No setting — this is structure, and adding a fourth role needs a reason, not a toggle.

---

## What is still genuinely a question, and why it cannot be a setting

Three of the four are now answered by Ben, 2026-09-10, and are recorded above rather
than left open:

- **Which days he works.** Any day, 7am–5pm. Roughly seventy service hours a week before a second crew — and route density, not hours, is what will actually cap him.
- **How he takes money today.** Cash and Venmo. So Stripe is being **added**, not substituted, and the seven existing customers must never be made to enter a card to keep service they already have. `customers.preferred_payment` and `payments.kind = 'manual'` are what make an offline payment a real record rather than a gap.
- **Whether the crew have phones.** Everyone has their own. Per-person login, per-person assignment and per-person completion attribution are all available from day one, which is what makes the driver-consistency promise enforceable rather than aspirational.

**One question is left, and it is a brand decision rather than a fact.**

`business.brand_region` defaults to `the 805`, which the research supports: it covers ~15
of his 16 cities, it is genuinely consumer-facing — Firestone Walker named a beer after
it — and his own number is (805) 869-8070, so he already is the 805. The caveat that
rides with it: Malibu, Agoura Hills and Westlake Village are Los Angeles County, so it
belongs in headline copy and never in a sentence defining who can book.

Ben's steer is to **think bigger than the 805 anyway**, and the answer to that is
structural rather than a better phrase. `service_areas.market` makes a second market a
value in a column; `service_areas.bookable` lets a city have a page before it has a
route. The copy can say whatever Josue likes, and the system does not care.

**Nothing is blocked.** Every setting has a working default, so if Josue never opens the
settings screen the business runs on the promises his own website already makes.
