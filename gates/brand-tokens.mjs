/**
 * S17: one brand system. No raw hex colour and no arbitrary font size in the NEW site code
 * outside tailwind.config.js and src/index.css.
 *
 *   node gates/brand-tokens.mjs
 *
 * Scope is the rebuilt surfaces (src/pages, src/layouts, src/components/{site,booking,account},
 * src/lib/catalog.ts). The legacy React admin is listed separately as debt, counted but not
 * failed, so the number can only go down. 2026-09-18: the dead half of that tree - App.tsx,
 * components/home, Nav, Footer, BookingWidget and every non-admin pages_react page - was
 * deleted once nothing imported it, which is most of the debt gone. What is left is the admin
 * island, which is live code and waits for its own rewrite (P18 §4).
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
const SCOPE = ['src/pages', 'src/layouts', 'src/components/site', 'src/components/booking', 'src/components/account']
  .flatMap(walk).concat(['src/lib/catalog.ts'].filter(keep))
  .filter((f) => /\.(astro|tsx|ts)$/.test(f) && !f.includes('src/pages/admin'));
const LEGACY = ['src/pages_react', 'src/components/home', 'src/components/admin'].flatMap(walk).concat(['src/components/Nav.tsx', 'src/components/Footer.tsx', 'src/components/BookingWidget.tsx'].filter(keep)).filter((f) => /\.(tsx|ts)$/.test(f));

// Class-string violations only: a hex inside an SVG path or an email template is not a token leak.
const HEX_CLASS = /\b(?:text|bg|border|ring|from|to|via|fill|stroke|shadow|outline|decoration)-\[#[0-9a-fA-F]{3,8}\]/g;
const ARB_SIZE = /\btext-\[\d*\.?\d+(?:px|rem|em)\]/g;

const scan = (files) => files.flatMap((f) => {
  const src = readFileSync(f, 'utf8');
  return [...src.matchAll(HEX_CLASS), ...src.matchAll(ARB_SIZE)].map((m) => `${f}: ${m[0]}`);
});

const planted = 'class="text-[#123456] text-[17px]"';
const control = [...planted.matchAll(HEX_CLASS), ...planted.matchAll(ARB_SIZE)].length === 2;
const found = scan(SCOPE);
const debt = scan(LEGACY);
console.log(`  negative control: ${control ? 'detector fires on a planted violation' : 'DETECTOR BLIND'}`);
console.log(`  scope: ${SCOPE.length} files, ${found.length} violation(s)`);
for (const v of found.slice(0, 10)) console.log(`    ${v}`);
console.log(`  legacy debt (not failed, tracked): ${debt.length} in ${LEGACY.length} files`);
const pass = control && found.length === 0;
console.log(pass ? `PASS ${SCOPE.length} files` : 'FAIL');
process.exit(pass ? 0 : 1);
