# Why the API "doesn't have the same file", and whether that is worth it

Ben, 2026-09-10: *"why do wierd stuff with vercel where it doesnt have the same file? is
there an advantage to this?"*

**Short answer: there is exactly one advantage, it is a Hobby-plan quota, and McGrath's
version of the workaround is worse than it needs to be. We are not copying it.**

## What the weird thing is

On McGrath's, `/api/admin/leads` is not a file. There is no `api/admin/leads.ts`. Instead
`vercel.json` rewrites `/api/admin/:path*` onto `api/admin.ts`, which reads `?path=` and
looks the handler up in a map. Fifty routes, seven files.

## Why it exists — the measured reason

Verified against Vercel's docs, 2026-09-10:

> When using other frameworks, or Vercel Functions directly without a framework, **every
> API maps directly to one Vercel Function.** For example, having five files inside
> `api/` would create five Vercel Functions. **For Hobby, this approach is limited to 12
> Vercel Functions per deployment.**
> — [vercel.com/docs/functions/runtimes](https://vercel.com/docs/functions/runtimes#functions-created-per-deployment)

And the plan limits table:

| Functions Created per Deployment | Hobby | Pro | Enterprise |
|---|---|---|---|
| | Framework-dependent | **∞** | **∞** |

`benamtech` is on **Hobby** (confirmed via the Vercel API, 2026-09-10). So with ~40 verbs
and a file each, we would need 40 functions and the cap is 12. That is the entire reason.
There is no performance benefit, no security benefit, no architectural benefit.

## What it costs

The cost is the exact property this whole system is being built for. `/api/admin/leads`
should be `cat server/verbs/admin.leads.ts`. When the URL stops naming a file, every
future agent — and every future human — has to read `vercel.json` and a dispatch map
before it can find the code that runs. We are spending legibility to buy a quota.

## What we do instead, and it is better than both options

**One function, one catch-all rewrite, one file per verb on disk.**

```
vercel.json     { "source": "/api/(.*)", "destination": "/api/index" }   ← ONE rewrite
api/index.ts    the only file in api/. Resolves the verb and calls it
server/verbs/   booking.start.ts · deposit.pay.ts · visit.complete.ts · …  ← one file each
```

`api/index.ts` imports a **generated** route map (`server/verbs/_index.ts`, written by a
build step that globs the directory), so adding a verb is adding one file and nothing
else. No hand-maintained rewrite list, no `?path=` convention to remember.

This gives us:

- **File-per-verb on disk.** The thing we actually wanted. `do(verb)` → `server/verbs/<verb>.ts`, always, no indirection to learn.
- **One deployed function.** Eleven under the cap, on Hobby, forever, no matter how many verbs the business grows.
- **Fewer cold starts than file-per-route.** One warm function beats forty cold ones — which is why Next.js and SvelteKit bundle this way by default and why their users "won't hit the limit of 12."
- **No `vercel.json` maintenance.** McGrath's has nine hand-written rewrites that must be kept in step with its route tree. Ours has one.

The generated index is the part that matters. A hand-maintained map drifts; a globbed one
cannot. `gates/` will carry `verb-index-current`: regenerate the map and require zero
diff, so a verb that exists on disk and not in the map fails the build rather than 404ing
in production.

## Should we just pay for Pro?

Not for this. Pro is $20/month/seat and removes the function cap — but the single-function
router is **better than file-per-route anyway** on cold starts and on `vercel.json`
maintenance, so we would build it the same way on Pro. Pro buys other things worth having
later (rollbacks, longer max duration, multi-region, real analytics). It is a business
decision for Ben, not a blocker for this build.

## One thing this unblocks elsewhere, today

`skills/build-website` records, as a live constraint on **Alvin's** festival site:

> "Vercel Hobby allows twelve serverless functions and this project is at exactly twelve.
> Adding an endpoint means merging one first."

That ceiling is liftable with the same pattern — collapse `api/*.ts` behind one router and
the cap stops mattering. Worth doing next time that project is touched, and worth
correcting in the skill, because "we cannot add an endpoint" has been shaping decisions on
a project that is not even blocked.

## The trap we are NOT copying

McGrath's `vercel.json` ends with:

```json
{ "source": "/((?!api/.*).*)", "destination": "/index.html" }
```

Correct for a Vite single-page app. **Catastrophic here.** It is the same instruction as
the Netlify `_redirects` fallback that made every one of Scoop Dogg's 71 URLs serve one
empty shell. Astro emits real HTML per route; a catch-all to `/index.html` would recreate
the exact bug we are fixing. Copy the API rewrite, delete the SPA fallback, and let
`gates/crawlable` prove it stayed deleted.
