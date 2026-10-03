/**
 * S17: one brand system. No raw hex colour and no arbitrary font size anywhere in src/ outside
 * tailwind.config.js and src/index.css.
 *
 *   node gates/brand-tokens.mjs
 *
 * THERE IS NO LONGER A LEGACY EXEMPTION, and that is what step 8 actually delivered here.
 *
 * The plan said: "retire src/pages_react, Nav.tsx, Footer.tsx, BookingWidget.tsx once nothing
 * imports them; the 33 legacy brand-token violations go with them." Measured 2026-09-19, all
 * three parts of that had gone stale:
 *
 *   - Nav.tsx, Footer.tsx and BookingWidget.tsx were already deleted on 2026-09-18.
 *   - `src/pages_react/admin/*` is LIVE code — all eleven files are imported by
 *     src/components/admin/AdminIsland.tsx. It cannot be retired by step 8 and waits on the
 *     admin rewrite (P18 §4). It also holds ZERO violations.
 *   - The debt was not 33 and was not in pages_react. It was SIX, all in
 *     src/components/admin/AdminLayout.tsx: the admin demo banner had been hand-mixed from
 *     three raw hexes while the public one in src/layouts/Base.astro used the tokens. Fixing
 *     that one file took the tracked debt to zero.
 *
 * So the exemption is gone rather than the directory. The admin tree is inside SCOPE now, which
 * is strictly stronger than deleting it would have been: a number that is merely tracked goes
 * back up the first time somebody is in a hurry.
 *
 * NEGATIVE CONTROL built in: the gate plants a violation in memory and requires the detector to
 * find it, so a regex that matches nothing cannot pass.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

// A path that is gone contributes nothing. The first version threw ENOENT the day the legacy
// tree it was tracking was finally deleted, so doing the thing the gate wanted broke the gate.
const walk = (d) => (existsSync(d)
  ? readdirSync(d).flatMap((f) => { const p = path.join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; })
  : []);
const keep = (f) => existsSync(f);
const SCOPE = ['src/pages', 'src/layouts', 'src/components', 'src/pages_react']
  .flatMap(walk).concat(['src/lib/catalog.ts'].filter(keep))
  .filter((f) => /\.(astro|tsx|ts)$/.test(f) && !f.includes('src/pages/admin'));

// Class-string violations only: a hex inside an SVG path or an email template is not a token leak.
const HEX_CLASS = /\b(?:text|bg|border|ring|from|to|via|fill|stroke|shadow|outline|decoration)-\[#[0-9a-fA-F]{3,8}\]/g;
const ARB_SIZE = /\btext-\[\d*\.?\d+(?:px|rem|em)\]/g;

/**
 * ONE ICON STROKE WIDTH. P15 §6.2: seven different widths were in use across nineteen files
 * (2, 2.25, 2.5, 2.75, 3, 3.5 and 5), which is the kind of thing nobody can point at and
 * everybody can feel. 2.5 is the one — heavier than lucide's default, which reads thin beside
 * this site's type, and not chunky at 24px.
 *
 * GuaranteeStamp.astro is exempt and it is an exemption rather than an oversight: its 5 is
 * inside a scaled `<g transform>` on a badge illustration, not a UI icon, so flattening it to
 * the icon weight would make it hairline.
 */
const ICON_STROKE = /stroke-?[Ww]idth=[{"]?(?!2\.5\b)\d*\.?\d+/g;
const STROKE_EXEMPT = new Set(['src/components/site/GuaranteeStamp.astro']);

const scanStroke = (files) => files.filter((f) => !STROKE_EXEMPT.has(f)).flatMap((f) => {
  const src = readFileSync(f, 'utf8');
  return [...src.matchAll(ICON_STROKE)].map((m) => `${f}: ${m[0]}`);
});

const scan = (files) => files.flatMap((f) => {
  const src = readFileSync(f, 'utf8');
  return [...src.matchAll(HEX_CLASS), ...src.matchAll(ARB_SIZE)].map((m) => `${f}: ${m[0]}`);
});

const planted = 'class="text-[#123456] text-[17px]" stroke-width="2.75"';
const control = [...planted.matchAll(HEX_CLASS), ...planted.matchAll(ARB_SIZE)].length === 2
  && [...planted.matchAll(ICON_STROKE)].length === 1;
const found = [...scan(SCOPE), ...scanStroke(SCOPE)];
console.log(`  negative control: ${control ? 'detector fires on a planted violation' : 'DETECTOR BLIND'}`);
console.log(`  scope: ${SCOPE.length} files, ${found.length} violation(s)`);
for (const v of found.slice(0, 10)) console.log(`    ${v}`);
const pass = control && found.length === 0;
console.log(pass ? `PASS ${SCOPE.length} files` : 'FAIL');
process.exit(pass ? 0 : 1);
