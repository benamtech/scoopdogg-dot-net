// node --test tests/
// Contrast is a number, not a look. Every text/surface pair the design system allows, computed
// from the bytes of tailwind.config.js and src/index.css, so changing a hex without re-checking
// its ratio fails here instead of on a customer's phone.
//
// WCAG 2.2 AA: 4.5:1 normal text, 3:1 large text (>= 24px, or >= 18.66px bold).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import config from '../tailwind.config.js';

type Rgb = [number, number, number];
const hex = (h: string): Rgb => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as Rgb;
const lum = (c: Rgb) => {
  const [r, g, b] = c.map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a: Rgb, b: Rgb) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

const colors = (config as any).theme.extend.colors;
const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');
// Read one surface's variables out of the CSS: `.tone-forest { --tone-bg: 27 67 50; ... }`.
const surface = (name: string): Record<string, Rgb> => {
  const block = css.match(new RegExp(`\\.tone-${name}\\b[^{]*\\{([^}]*)\\}`));
  assert.ok(block, `.tone-${name} is not defined in src/index.css`);
  return Object.fromEntries(
    [...block[1].matchAll(/--tone-(\w+):\s*(\d+)\s+(\d+)\s+(\d+)/g)].map((m) => [m[1], [Number(m[2]), Number(m[3]), Number(m[4])] as Rgb]),
  );
};

const NORMAL = 4.5;
const LARGE = 3;

for (const name of ['white', 'tint', 'forest', 'deep']) {
  test(`${name} surface: every text colour passes as normal text`, () => {
    const s = surface(name);
    for (const k of ['fg', 'heading', 'muted', 'accent'] as const) {
      const r = ratio(s[k], s.bg);
      assert.ok(r >= NORMAL, `${k} on ${name} is ${r.toFixed(2)}:1, needs ${NORMAL}`);
    }
  });
}

test('orange surface: white passes only as large text, and the accent passes as normal text', () => {
  const s = surface('orange');
  const white = ratio(s.fg, s.bg);
  assert.ok(white >= LARGE, `white on orange is ${white.toFixed(2)}:1, needs ${LARGE} even for large text`);
  // If this ever passes 4.5 the orange has gone brown: the rule "large text only" can relax,
  // but look at it beside the emblem first.
  assert.ok(white < NORMAL, `white on orange is ${white.toFixed(2)}:1 — the band orange changed; revisit the large-text-only rule`);
  const accent = ratio(s.accent, s.bg);
  assert.ok(accent >= NORMAL, `accent on orange is ${accent.toFixed(2)}:1, needs ${NORMAL}`);
});

test('the band orange in the CSS is the orange in the config', () => {
  const s = surface('orange');
  assert.deepEqual(s.bg, hex(colors.orange[600]));
  assert.deepEqual(surface('forest').bg, hex(colors.forest[700]));
});

test('buttons: text on every button surface passes as normal text', () => {
  const pairs: [string, string, string][] = [
    ['primary: forest-900 on amber-500', colors.forest[900], colors.amber[500]],
    ['forest: white on forest-700', '#FFFFFF', colors.forest[700]],
    ['white: forest-800 on paper', colors.forest[800], colors.paper],
    ['small orange text on white', colors.orange[700], colors.paper],
  ];
  for (const [n, fg, bg] of pairs) {
    const r = ratio(hex(fg), hex(bg));
    assert.ok(r >= NORMAL, `${n} is ${r.toFixed(2)}:1`);
  }
});

test('never: white text on the old amber (the predecessor site did this)', () => {
  assert.ok(ratio(hex('#FFFFFF'), hex(colors.amber[500])) < LARGE, 'amber is dark enough for white now — was the palette changed on purpose?');
});
