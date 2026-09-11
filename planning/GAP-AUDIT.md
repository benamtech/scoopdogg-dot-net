# Gap audit — 2026-09-10

Ben: *"take a step back and find everything we missed... the whole goal was to have a
full site on vercel with full admin setup, with super admin and admin."*

Written after he caught that the rebuild had no `/admin`. Every row below was checked
against the old `src/App.tsx` route table, the deleted `public/_redirects`, and the live
site — not from memory.

## Regressions I introduced and did not flag

| # | Gap | Consequence at cutover | Status |
|---|---|---|---|
| 1 | **No `/admin` at all.** Six routes existed and worked: `/admin/login`, `/admin`, `/admin/leads`, `/admin/leads/:id`, `/admin/messages`, `/admin/messages/:id` | Josue loses the only screen where he can read a lead. Email becomes the only channel | **FIXED** |
| 2 | **`/areas/westlake` → `/areas/westlake-village` 301 deleted** with `public/_redirects` | A live URL 404s | **FIXED** |
| 3 | **71 city×service URLs advertised in the live sitemap would 404**, because the page flag is `none` and nothing redirects them | Every one of those URLs Google holds turns into a 404 on the day of the switch. Worse than the thin pages I turned off to avoid | **FIXED** |

`robots.txt` was checked and is not a regression — it still carries `Disallow: /admin/`
and points at the sitemap.

## Planned, never built — and correctly so, for now

Ben's instruction is that the portal and deposit flow stay **off**. These are designed in
`planning/` and are the next build, not gaps in this one:

| Not built | Why that is fine today |
|---|---|
| Customer portal | Off by instruction |
| Deposit / checkout flow | Off by instruction, and the Stripe key has no Connect scope |
| Crew app | No crew accounts yet |
| The verb layer | The two write paths that exist (`/api/lead`, `/api/contact`) are hand-written and tested. The verb layer is the generalisation, needed when there are forty writes, not two |
| Settings UI | Settings are rows; `scripts/set-setting.mjs` changes them today |

## What the admin must be

Ben, verbatim: **superadmin is `ben@amtechai.com`, admin is `scoopdogg129@gmail.com`.**

- Email is the login. A six-digit code by email is the proof. No password to lose, no JWT in a browser.
- The session is a row in this database behind an httpOnly cookie.
- Only an address in `team_members` with `status = 'active'` can be sent a code. An unknown address gets the same answer as a known one and no code.
- `superadmin` sees everything including team and settings. `admin` sees the business: leads, messages, and their statuses.
- `/admin/*` is `noindex` and stays behind `Disallow: /admin/`.


---

## Fixed and verified, 2026-09-10

| Gap | Fix | Proof |
|---|---|---|
| No `/admin` | Six routes rebuilt: `/admin/login`, `/admin`, `/admin/leads`, `/admin/leads/<id>`, `/admin/messages`, `/admin/messages/<id>` | 48 pages built; all four index pages return `noindex` with a server-rendered island |
| Auth | Email + six-digit code, session row behind an httpOnly cookie. Ported in spirit from McGrath's `_private.ts` | `gates/admin-e2e.mjs` — **20/20** against the deployment |
| Roles | `superadmin` ben@amtechai.com, `admin` scoopdogg129@gmail.com, per Ben | superadmin reads team and settings; admin gets **403** on both |
| `/areas/westlake` | 308 redirect restored in `vercel.json` | verified on the deployment → `/areas/westlake-village` |
| 71 city×service URLs would 404 | One redirect rule covering all 176 combinations → the matching `/services/<slug>` page | verified: `/areas/ventura/weekly-pooper-scooper-service` → 308 → `/services/weekly-pooper-scooper-service` |
| Admin was in the sitemap | `sitemap()` filter excludes `/admin` | new gate `admin-not-in-sitemap` |
| `SESSION_SECRET` fell back to `DATABASE_URL` | dedicated 256-bit secret, pushed sealed, recorded in `brain/.env` as `SCOOPDOGG_SESSION_SECRET` | sign-in only works once the deployment carries it, which is how the gap was found |

**Gate totals: build 20/20, content 24/24, schema 25/25, admin 20/20.**

Two things the old admin did that the new one deliberately does not:

- **`signUp` on the login screen.** The old page fell back to creating an account, so anyone who found the URL could make themselves an admin. Access is now a row in `team_members` and the login screen cannot create one.
- **Query the database from the browser.** The old admin held a key that could read every customer record. Every read now goes through `/api/admin/*` on the server.
