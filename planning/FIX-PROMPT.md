# Fix prompt — Scoop Dogg, 2026-09-11

> **DONE, 2026-09-11.** All five edges closed and every falsifier exercised. What each
> one turned out to be, including the two that were larger than this prompt knew, is in
> `notes/2026-09-11-scoopdogg-fix-prompt-five-edges.md`. Gates now: build 24/24,
> content 24/24, schema 25/25, admin API 20/20, admin browser 15/15. Do not re-run this
> prompt; read the note.

Five edges. Each carries a **claim**, a **probe** that shows it, an **expect** that is
green, and a **falsifier** that must fail before the fix and pass after.

Do D0 first. It is why D1 shipped twice.

Run from `CLIENT-SITES/scoopdogg-dot-net`. `npm run build` runs the gates.

---

**D0 · two card renderers, one design**
- claim: `Services.tsx` renders service cards twice — the `ServiceCard` component (L171) and an inline block for `petAddonServices` (L492). A prop added to the component reaches half the cards.
- probe: `grep -n 'petAddonServices.map\|<ServiceCard' src/components/home/Services.tsx`
- expect: `petAddonServices` render through `ServiceCard`; one card renderer in the file.
- falsifier: change one card prop and it must show on every card. If it shows on some, they are still two renderers.

**D1 · litter-robot art floats** (Ben reported twice)
- claim: `/img/5878.jpg` is a framed illustrated scene with its own border, not a transparent cut-out, and renders `absolute -top-36 -right-6 w-64 h-64` — a rectangle pasted over the card. `framedMascot` exists and only `ServiceCard` honours it, so this card never got it.
- probe: `grep -o 'src="/img/5878[^>]*class="[^"]*"' dist/index.html`
- expect: no `absolute` in that image's class. Framed, centred, with room — as it already renders on `/services`.
- falsifier: gate `framed-art-not-floated` — an `<img>` whose source has no transparent pixels must not carry `absolute`. Must be shown to fail the current tree.

**D2 · gaps that exist only to clear floating art**
- claim: `gap-y-44 mt-40` (L492) and `gap-y-28 mt-36` ×3 (L360, L377, L401) are clearance for mascots that hang above the cards. Once D1 lands they are holes in the page. Already fixed on `/services`; never applied to the homepage.
- probe: `grep -n 'gap-y-44\|mt-40\|gap-y-28\|mt-36' src/components/home/Services.tsx`
- expect: normal rhythm, no empty band between card rows.
- falsifier: screenshot the homepage services bands at 1280 and 390 and look at them. This one is only settled by eye.

**D3 · no gate diffs the old routes against the new build**
- claim: the rebuild silently dropped six admin routes, a `/areas/westlake` 301 that lived in `public/_redirects`, and 71 sitemap URLs. All gates test what the new site **has**; none test what the old one **served**. Nothing stops it recurring.
- probe: `grep -l 'App.tsx\|old_routes\|predecessor' gates/*` → nothing
- expect: a gate that reads the predecessor route table (`git show HEAD:src/App.tsx`), `git show HEAD:public/_redirects`, and the live `sitemap.xml`, and fails on any path that neither builds nor redirects.
- falsifier: delete one `vercel.json` redirect and the gate must go red.

**D4 · five admin screens never opened in a browser**
- claim: `/admin`, `/admin/leads`, `/admin/messages`, `/admin/lead`, `/admin/message` were verified by API response and by HTML being present. Only `/admin/login` was looked at. A `client:load` island that throws on first render still serves markup that `curl` reads as fine.
- probe: sign in, screenshot each of the five with `page.on('pageerror')` attached and `response` watched for 5xx.
- expect: each renders real content — the `AMTECH SITE TEST` lead is in the database for exactly this — with no console error.
- falsifier: assert on text that exists only when signed in. `/Leads/i` passes against a login page and tells you nothing.

---

**Done when:** build 20+/20, content 24/24, schema 25/25, admin 20/20; the new gates (D1,
D3) have each been shown to fail the pre-fix tree; and the homepage and `/services` have
been screenshotted at 1280 and 390 and looked at.

**Do not:** blanket-replace a colour class, change the amber/forest/cream tokens, restyle
to the AMTECH brand, or turn the 176 city×service pages on.

---

## Two findings withdrawn, and why — read this before re-raising them

An earlier draft of this prompt carried two contrast defects. **Neither survived
classification, and both were mine.**

- *"amber text on white, 192 places, 2.12:1"* → really **212 SVG icons** (review stars and checkmarks), **107 hover states on dark footers** that a class-string match read as resting small text, and **9 real instances**: three required-field asterisks and one display pull-quote.
- *"white on amber, 82 places"* → really **32 white star icons** on an amber band. No text at all. The 82 came from inheriting `bg-amber` down through descendants and counting `text-white/70` opacity variants as `text-white`.

Ben, 2026-09-11, on the asterisks, the icons and the pull-quote: **"those three things aren't an issue at all."** He is right, and the numbers say so too — gold stars on white and white stars on amber are the convention on every review surface there is, and the star's shape carries the rating, not its colour.

**So do not add an inherited-background contrast gate.** It was in the earlier draft as a
fix for these findings; it would have produced 82 false alarms and sent a seat chasing
stars. Contrast on this site is clean for text, and the class-pair gate in
`gates/e2e.mjs` already covers the real pairs. If a contrast finding ever comes back,
**classify it by the element that carries the colour before reporting a count** — icons,
hover states and copy have different thresholds and different answers.
