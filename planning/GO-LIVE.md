# Go live — the exact steps

State as of 2026-09-10. Everything below is measured, not assumed.

## Where it stands

| | |
|---|---|
| Site | Built, deployed, **Ready** on Vercel project `scoopdogg` (`prj_ybTE2biJpQaxQGBNuwPFQ2xX3POt`) |
| Gates | 16 build gates, 24 end-to-end checks, **all green** |
| Database | Neon, connected, 8 migrations applied, 24 real leads, full catalog, 42 settings |
| Booking + contact | `POST /api/lead`, `POST /api/contact`, both tested against the live database |
| Domains | `scoopdogg.net` and `www.scoopdogg.net` attached to the project |
| DNS | **Not pointed yet.** Still `ns1/ns2.dns-parking.com` (Hostinger), apex `A` at Netlify |
| Live site | Untouched and still serving. Leads keep arriving the old way until cutover |

## Credentials — done, and one that is not

**`RESEND_API_KEY` is set and PROVEN.** Pushed from `brain/.env` into all three Vercel
environments with `bin/push-env.py`, which pipes the value straight into `vercel env add`
and never prints it. Then proven end to end on the deployed site: a lead POSTed to
`/api/lead` saved to Neon and the alert was **delivered** to `ben@amtechai.com`
(Resend shows `delivered`, subject `New Lead: GOLIVE-… — Keep It Clean`). Test rows
removed; 24 real leads intact.

One thing that bit on the way, now fixed in code: Resend sits behind Cloudflare, which
answers a bare or library user agent with `403 error code: 1010`. That reads exactly like
a dead API key. `api/lead.ts` and `api/contact.ts` now send an explicit `User-Agent`.

**Lead alerts go to Ben only until Saturday.** `notify.lead_recipients` in the database is
`["ben@amtechai.com"]`, changed from Josue's two addresses so nothing in testing reaches
him before Ben has shown him the work. **This is the row to change on Saturday:**

```
node --env-file=.env.local scripts/set-setting.mjs \
  notify.lead_recipients '["josue@scoopdogg.net","scoopdogg129@gmail.com"]'
```

**`STRIPE_SECRET_KEY` is set and the key is valid — but it cannot do Connect.**

The value in `brain/.env` was briefly unusable because the Stripe and Firecrawl keys had
run onto one line; Ben fixed that and it is now a clean 107-character `rk_live_`
restricted key. Probed against Stripe's own API on 2026-09-10:

| Capability | Result |
|---|---|
| read balance | **yes** |
| read / create payment intents | **yes** |
| read customers, read products | **yes** |
| read the platform account | **403 more_permissions_required** |
| list connected accounts | **403 more_permissions_required** |
| create an onboarding Account Link | **403 more_permissions_required** |

So the key can take a payment on AMTECH's own account, and **cannot run Connect at all** —
which is the whole design: Josue as the merchant of record on his own connected account,
with AMTECH taking a 4% application fee.

**The fix is a permissions edit, not a new key.** In the Stripe dashboard, edit this
restricted key and grant **write on Connect → Accounts** plus **read on Account**. Then
re-probe:

```
node --env-file=.env.local scripts/probe-stripe.mjs
```

That script writes what it measured into `stripe_connection`, so the admin and every money
verb read a probed fact rather than an assumption. Nothing else on the site is blocked by
this — leads and bookings do not touch Stripe.

Note on the local file: Vercel stores these as **sensitive**, so `vercel env pull` writes
the literal string `[SENSITIVE]` instead of the value. That is correct. The value is
readable at runtime — proven, because the deployed function sent a real lead alert — and
the probe script falls back to the brain's sealed `.env` for a local run.

## Two Vercel projects exist — use `scoopdogg`

| Project | ID | Age | Domain | Use it? |
|---|---|---|---|---|
| **`scoopdogg`** | `prj_ybTE2biJpQaxQGBNuwPFQ2xX3POt` | today | **holds `scoopdogg.net` + `www`** | **yes** |
| `scoopdogg-dot-net` | `prj_CqoQzFlT37MyiTuIvpyyEeQy0zHJ` | 66 days | none | no — dormant, Vite preset, never finished |

The second one is not mine and predates this work; I created `scoopdogg` before checking
and only found the older one afterwards. It holds no domain and no traffic. Deleting it is
Ben's call — it is a destructive, outward-facing action and I have not touched it. Leaving
it is the same trap Summit has: two projects with similar names, one of them live.

## The DNS handover

Two ways. **Option A is the one to give Josue** — it is a single record and it cannot
touch his email.

### Option A — change one record where the DNS already lives (recommended)

At Hostinger, change the apex `A` record and add one for `www`:

| Type | Name | Value |
|---|---|---|
| `A` | `@` (scoopdogg.net) | `76.76.21.21` |
| `A` | `www` | `76.76.21.21` |

Remove the existing `A 75.2.60.5` (Netlify) and the `www` CNAME to `site-dns.bolt.host`.

**Leave everything else exactly as it is.** These records are what keep his business
running and none of them need to change:

| Record | Current value | What it does |
|---|---|---|
| `MX` | `mx1.hostinger.com`, `mx2.hostinger.com` | **His `josue@scoopdogg.net` inbox.** Drop this and his email stops |
| `TXT` | `v=spf1 include:_spf.mail.hostinger.com ~all` | Lets his outgoing mail pass SPF |
| `TXT` `_dmarc` | `v=DMARC1; p=none` | Monitor-only policy. Carry it as-is |
| `TXT` | `google-site-verification=SgKa--HfuQ…` | Verifies a Google property by DNS. Dropping it can lose Search Console, and possibly Business Profile |

### Option B — move the whole zone to Cloudflare

Matches `brain/infrastructure.md` (Vercel host, Cloudflare DNS). More work and more risk,
because every record above has to be recreated correctly. Worth doing, but not on the
same day as the cutover. Do A first, B deliberately later.

## After DNS propagates

```
curl -sS -D - -o /dev/null https://scoopdogg.net/ | grep -i '^server:'      # expect Vercel
curl -sS https://scoopdogg.net/areas/ventura | grep -c '<h1'                # expect 1
curl -sS https://scoopdogg.net/services/weekly-pooper-scooper-service | grep -o '<title>[^<]*'
```

Then **open it in a real browser** and walk it. That is the one proof class this project
has never exercised, and it needs a person.

## What is NOT built yet, so nobody assumes it is

- **No admin panel.** Josue cannot yet see leads in a screen. The email is the lead path.
- **No customer portal, no booking-to-payment flow, no crew app.** Designed (`planning/`), not built.
- **Stripe is not connected.** The schema and the 4% fee are in place; the AMTECH Connect platform does not exist yet.
- **The 176 city×service pages are off.** One word in `src/lib/site-config.ts`. The reason is measured and written there.
