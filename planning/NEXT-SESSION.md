# NEXT SESSION — Scoop Dogg

Written 2026-09-10 by dax. Read this, then `00-WHERE-WE-ARE.md`. Do not re-derive
what is below; it is all measured or decided.

```
python bin/snapshot.py                    # first, always
python bin/state.py                       # the world
python bin/brief.py scoopdogg             # this client in full
python bin/lesson.py brief && python bin/retract.py brief
bash CLIENT-SITES/scoopdogg-dot-net/gates/schema-guards.sh   # expect 20/20
```

**Goal.** A self-serve portal + admin CMS for Scoop Dogg (Josue Isaac, Ventura CA).
Ben's sequence is strict: **portal completely, then the AI employee.** Brief verbatim:
`notes/2026-09-09-scoopdogg-ben-brief.md`.

**Two gates, always.** Ben sets every price. Nothing reaches Josue without Ben.
His brand, not AMTECH's — DM Serif Display + Outfit, his colours.

---

## Built and verified (do not rebuild)

| | Where | Proof |
|---|---|---|
| Core schema, 17 tables | `migrations/001_core.sql` | applies clean, PG17 |
| 24 leads migrated | `migrations/002_leads.sql` | generated from JSON verified field-by-field vs live |
| Catalog (the CMS) | `migrations/003_catalog.sql` | services, tiers, areas, offers, articles, reviews |
| Catalog seed | `migrations/004_catalog_seed.sql` | **11 services, 34 tiers, 16 areas, 18 reviews** from his own TS |
| Stripe connection | `migrations/005_stripe.sql` | one row, probed not assumed |
| Schema gate | `gates/schema-guards.sh` | **20/20**, each guard asserted in both directions |
| Astro spike | `output/spikes/2026-09-10-astro-api-coexistence/` | real HTML per route; no `.vercel/` claimed |
| Restore rehearsal | `output/backups/scoopdogg-2026-09-09/rehearse-restore.sh` | 24/0/3/0 |

Regenerators (never hand-edit 002/004): `scripts/build-leads-migration.py`,
`node --experimental-strip-types scripts/build-catalog-seed.mjs`.

## Decided — do not relitigate

| Decision | Reason |
|---|---|
| **Vercel host, Cloudflare DNS, Neon or Supabase whichever is cheaper** | Ben's standing standard. `brain/infrastructure.md` |
| **Neon** here | scales to zero; Supabase Pro bills 24/7 and we use none of its bundle |
| **Astro static, no adapter** | 200 pages must be real HTML; a bolted-on prerenderer is what failed |
| **One function + generated verb index** | Hobby caps non-framework `api/` at **12 functions**; Pro is ∞. `02-DEPLOYMENT.md` |
| **Copy McGrath's auth** | `CLIENT-SITES/mcgrathspub/website/server/routes/_private.ts` + `_utils.ts` + `api/_dispatch.ts` |
| **Stripe Connect Onboarding, Standard** | NOT OAuth — Stripe: "not recommended for new platforms". Lets Josue bring an existing account |
| **No Stripe Product mirror** | Price objects are immutable; a scooping month is variable; 9/11 services end in a quote tier |
| **Platform fee 4%** | Ben. NB `brain/revenue-model.md` still says 7% — reconcile, don't overwrite |
| **Rebuild in place** on `rebuild/portal` | repo clean on `main`, 4 commits |

## Build next, in order

1. **Content pull/publish** — `npm run content:pull` as build step 1 → `content/*.json`; publish fires a Vercel deploy hook; `content_publishes` records which happened. **Wire all three or none.**
2. **Static site from the corpus** — turns the blackout green. **Highest value in the project and it needs nobody.**
3. **Verb layer** — `server/verbs/<verb>.ts`, one file each; `api/index.ts` the only file in `api/`; one catch-all rewrite. Gate `verb-index-current` = regenerate the map, require 0 diff.
4. **Auth** — port McGrath's. Customers get phone OTP first.
5. **Admin CMS** — services, tiers, areas, offers, reviews, team, settings, Stripe connect button.
6. **Customer portal** — book → quote → deposit → scheduled → "on his way" → completion photo.
7. **Crew app** — today's route, en route, complete + photo, failed access.
8. **Cutover** — three moves, see below.

## Traps — every one of these has already bitten

- **Do not copy McGrath's SPA catch-all** `{"source":"/((?!api/.*).*)","destination":"/index.html"}`. It is the Netlify `_redirects` bug that made all 71 URLs serve one shell.
- **A "from" price is not a price.** 3 tiers flagged `price_is_from`. Never render as final.
- **`price_basis='choice'`** on `one-time-dog-poop-cleanup` and `weekly-yard-maintenance` — they price on a category, not a number. Asking "how many dogs?" mis-quotes.
- **Money is frozen.** Rate copied onto the subscription at signup, onto the invoice at charge. Settings are current config only.
- **Stripe capability is probed.** `charges_enabled` false ⇒ money verbs refuse *visibly*.
- **Cash stays.** He is paid cash/Venmo today; the 7 existing customers never forced onto cards.
- **Never let an admin form read values back out of the DOM.**
- **`React.lazy` never wraps a public page.** `grep -rl 'Loading' dist --include='index.html'` ⇒ nothing.
- **Blank admin page = first-render throw.** Attach `page.on('pageerror')` before theorising.
- **Measure contrast, never reason about it.**

## Live site is FROZEN

Netlify (not Vercel), DNS at Hostinger (not Cloudflare). All **71 sitemap URLs serve the
same 6,962-byte shell**, 0 `<h1>`. **Every lead is publicly readable and stays that way
until cutover — that makes cutover a security deadline.** The Supabase keepalive must
keep running until then or his booking form dies.

**Cutover is three moves, not one:**
1. Zone → Cloudflare, **record by record**. `MX` = Hostinger mail (his inbox rides this), SPF, DMARC `p=none`, and a `google-site-verification` TXT. Carry his SPF unchanged; lead mail sends from `mail.amtechleads.com` and authenticates on its own.
2. Apex → Vercel, confirm the certificate.
3. Migrate the DB, retire the Supabase project.

## Waiting on Ben (nothing below blocks steps 1–7)

- AMTECH Stripe Connect platform — needed to *test* payments end to end, not to build.
- **GBP + Google Search Console access.** Cheapest high-value items on the project: GBP is 28.5% of AI local citations, and Search Console puts numbers on the blackout from Josue's own account.
- Registrar login for `scoopdogg.net`, before cutover.
- 4% vs the recorded 7%.
- Who owns the Neon project and the domain after the rebuild.
- Confirm "the 805" as brand copy (Malibu/Agoura/Westlake are LA County — headline only, never a boundary claim).
- Commercial terms: nothing on disk records them.

## Close the session

```
python bin/log.py scoopdogg "..." --next "..."
python bin/validate.py && python bin/oracle.py
python bin/lesson.py add "..." --by dax --cost "..." --say     # only if transferable
python bin/snapshot.py
```
Note in `notes/`. A session that read state and never called `log.py` left nothing behind.
