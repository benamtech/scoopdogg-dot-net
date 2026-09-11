# Where we are, and what is actually missing

2026-09-10. Written because Ben asked for a step back: what do we really have set up
versus what do we need. Everything in the "have" column was verified this session, not
read off a document.

## The honest summary

**We have more than the plan assumed, and the gap is narrower than it looks.** Josue has
already written the hard part — a complete 11-service rate card, 16 city pages, 6
articles and a real service policy — and published it. What is missing is not knowledge.
It is that **none of it is connected to anything that can take a booking, hold a
customer, or run a route.**

The site is a brochure with a lead form. The business is a phone and a person's memory.

## What we have

### Content, and it is the expensive part

| | Count | Where | State |
|---|---|---|---|
| Services with full published pricing | **11** | `src/lib/services.ts` | Complete. Tiers, notes, FAQs, what's included |
| Cities | **16** | `src/lib/cities.ts` | Complete. Neighbourhoods, local context, FAQs |
| Articles | **6** | `src/lib/articles.ts` | Complete, sourced, structured |
| Featured reviews | **18** | `src/lib/reviews.ts` | Real, with Google URLs |
| `llms.txt` | 7,046 bytes | `public/` | Served, accurate |

**2,255 lines of typed content data.** This is the asset. It is already structured data
rather than markup, which is why promoting it to a validated corpus is a port and not a
rewrite.

### Policy, already decided and already public

Josue's own site commits him to a service policy. That matters more than it sounds:
**these are not open questions, they are public promises**, and they are the right
defaults for every setting.

- "No sign-up fees. Cancel or pause anytime."
- "Never [a contract]. We earn your business every visit. Cancel anytime with no questions asked."
- "Skip a week, pause for vacation... No fees for skipping or pausing."
- "Same day every week."
- "You never need to be home. Just make sure we have gate access."
- "Same-day text confirmation when complete."
- "Most new customers are confirmed within 24 hours and start within a few days, depending on route availability."
- "All waste double-bagged and removed from your property. It does not go in your trash cans."

### Data

- **24 leads.** Verified 2026-09-10 as byte-identical between `leads.json` and the live database, every row, every field. Feb 23 to Sep 3 2026. All 24 have a name, phone, email and address.
- Status spread: 7 active, 9 declined, 7 new, 1 contacted.
- Cities: Ventura 12, Oxnard 3, Santa Paula 3, Camarillo 2, Ojai 2, Simi Valley 1, Westlake Village 1.
- Services asked for: weekly 9, turf 4, yard-deep-clean 3, kitty-litter 3, one-time 3, dog-run 1, litter-robot 1.

**Seven active customers is the business today.** Design for hundreds; migrate seven.

### Infrastructure

- Repo is clean, `main`, 4 commits, remote at `benamtech/scoopdogg-dot-net`.
- Vercel account `benamtech` on the **Hobby** plan.
- Supabase project in AMTECH's org, free tier, kept alive by a cron hack.

## What we do NOT have

Nothing in this list exists in any form. This is the whole build.

| Missing | Consequence today |
|---|---|
| **A customer record** | A lead is a form submission. There is no person, no history, no repeat |
| **A property record** | Gate code, yard size, dog count and access notes live in a `notes` text field or in Josue's head |
| **A subscription** | "Weekly service" is an arrangement, not a row. Nothing knows who is due |
| **A visit** | There is no record that anyone went anywhere. No completion, no photo, no proof |
| **A schedule** | "Same day every week" is a promise a human keeps by remembering |
| **Payment** | Entirely outside the system |
| **A team member** | "Every team member is background-checked" — none of them exist in software |
| **Auth for anyone but an admin** | 2 auth users. A customer cannot log in because there is nothing to log into |
| **Settings** | Every policy above is hardcoded in page copy. Changing a price means a deploy |
| **Any audit trail** | Nothing records what happened or who did it |

## The three gaps that decide the shape

**1. The content is dark.** All 71 sitemap URLs serve the same 6,962-byte shell. The most
valuable thing Josue owns is switched off. Fixing this is Phase 2 and it is independently
worth doing even if nothing else shipped.

**2. Every policy is a hardcoded string.** His prices live in a TypeScript array inside a
bundle. Raising a price is a code change and a deploy. That is the headache that
compounds fastest as he grows, and the fix is `01-SETTINGS.md`.

**3. There is no spine.** Customer → property → subscription → visit → payment does not
exist at any layer. Everything else is decoration on top of that.

## What this changes about the plan

- **Do not restore the old database.** Ben, 2026-09-10: copying Supabase exactly copies its errors. The 24 leads are verified in JSON; the schema is rebuilt from scratch. `verify-leads.py` is the gate.
- **Most "ask Josue" questions are already answered by his own site.** They become settings with sourced defaults, not blockers. See `01-SETTINGS.md`.
- **The rate card is a data structure, not prose.** Eleven services, each with 2-3 measurable tiers and a "custom quote" top tier. That is the pricing engine, and it is already written.
