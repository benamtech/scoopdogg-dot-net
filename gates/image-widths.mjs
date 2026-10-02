/**
 * Every image is served at a width it asked for, at a quality somebody chose.
 *
 *   npm run build && node gates/image-widths.mjs
 *
 * THE FAULT, measured 2026-10-02 on a deployed preview. Vercel's image CDN serves only the widths
 * listed in the adapter's `imagesConfig.sizes`. The adapter drops any `widths={[...]}` value that
 * is not on that list WITHOUT A WORD, and when none survive it serves the width nearest the
 * source file. The default list started at 640, so a cartoon drawn at 160px asked for
 * [160, 320], lost both, and arrived at 1080px and quality 100: 335KB for a thumbnail. The same
 * default made every photograph on the site quality 100, because the adapter's fallback for an
 * unstated quality is 100.
 *
 * Nothing failed. The page rendered, the gates were green, and Lighthouse's hint was one line
 * among thirty. So this reads the three places that have to agree:
 *
 *   1. every width a component asks for is on the CDN's list (source against config)
 *   2. every <Image> states its quality (source)
 *   3. no built page requests an image at quality 100 (the bytes that ship)
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';

let pass = 0, fail = 0;
const ok = (w, d = '') => { pass++; console.log(`  PASS  ${w}${d ? ` — ${d}` : ''}`); };
const no = (w, d = '') => { fail++; console.log(`  FAIL  ${w}${d ? ` — ${d}` : ''}`); };
const walk = (d, ext) => (existsSync(d) ? readdirSync(d).flatMap((f) => { const p = path.join(d, f); return statSync(p).isDirectory() ? walk(p, ext) : p.endsWith(ext) ? [p] : []; }) : []);

const analyse = (tags, sizes) => {
  const dropped = [], unstated = [];
  for (const { file, tag } of tags) {
    const m = /widths=\{\[([^\]]*)\]\}/.exec(tag);
    for (const w of (m ? m[1].split(',').map((x) => Number(x.trim())).filter(Boolean) : [])) if (!sizes.includes(w)) dropped.push(`${file}: ${w}`);
    if (!/\bquality=/.test(tag)) unstated.push(file);
  }
  return { dropped, unstated };
};

// ---- negative control ----------------------------------------------------------------------
{
  const bad = analyse([{ file: 'planted.astro', tag: '<Image src={x} widths={[160, 640]} />' }], [640, 750]);
  const good = analyse([{ file: 'planted.astro', tag: '<Image quality={75} src={x} widths={[640]} />' }], [640, 750]);
  bad.dropped.length === 1 && bad.unstated.length === 1 && !good.dropped.length && !good.unstated.length
    ? ok('negative control: a dropped width and an unstated quality are both caught')
    : no('negative control: the detector is blind — nothing below can be trusted');
}

const config = readFileSync('astro.config.mjs', 'utf8');
const sizes = (/sizes:\s*\[([^\]]+)\]/.exec(config)?.[1] ?? '').split(',').map((x) => Number(x.trim())).filter(Boolean);
sizes.length > 8 ? ok('the adapter names its widths', `${sizes.length} widths, ${sizes[0]} to ${sizes[sizes.length - 1]}`) : no('the adapter names its widths', 'no imagesConfig.sizes in astro.config.mjs');

const tags = walk('src', '.astro').flatMap((file) => [...readFileSync(file, 'utf8').matchAll(/<Image\b[\s\S]*?\/>/g)].map((m) => ({ file, tag: m[0] })));
// getImage() is the same call in script form; the hero's preload uses it.
const calls = walk('src', '.astro').flatMap((file) => [...readFileSync(file, 'utf8').matchAll(/getImage\(\{[\s\S]*?\}\)/g)].map((m) => ({ file, tag: m[0].replace(/widths:\s*\[([^\]]*)\]/, 'widths={[$1]}').replace(/quality:/, 'quality=') })));
const { dropped, unstated } = analyse([...tags, ...calls], sizes);
tags.length > 8 ? ok('images found in the source', `${tags.length} <Image>, ${calls.length} getImage()`) : no('images found in the source', `${tags.length} — the scan is probably broken`);
dropped.length ? no('every width a component asks for is one the CDN serves', dropped.slice(0, 6).join('; ')) : ok('every width a component asks for is one the CDN serves');
unstated.length ? no('every image states its quality', [...new Set(unstated)].slice(0, 6).join('; ')) : ok('every image states its quality');

const html = walk('dist', '.html');
const full = html.filter((f) => /_vercel\/image\?[^"]*q=100/.test(readFileSync(f, 'utf8')));
html.length > 20
  ? (full.length ? no('no built page requests an image at quality 100', `${full.length} pages, e.g. ${full.slice(0, 3).join(', ')}`) : ok('no built page requests an image at quality 100', `${html.length} pages`))
  : no('the built site is there', `${html.length} pages in dist/`);

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
