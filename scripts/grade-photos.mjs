/**
 * Grade the yard photographs: one temperature, one exposure, one crop ratio.
 *
 *   node scripts/grade-photos.mjs --measure      # say what is there, change nothing
 *   node scripts/grade-photos.mjs                # grade from the originals
 *
 * P15 §6.1, the first item of step 7, and the biggest visible gain per hour in the whole port.
 * These are Josue's own photographs of his own jobs, shot on different days on a phone — which
 * is exactly the kind of picture NN/g's eyetracking finds people actually look at, and exactly
 * the kind that looks amateur when eight of them sit in a row at four different white balances.
 * The fix is not better photographs. It is the same photographs, agreeing with each other.
 *
 * IT ALWAYS GRADES FROM THE ORIGINALS, NEVER FROM THE LAST RUN. `assets-originals/photos/` holds
 * the untouched files and is written once; `src/assets/photos/` is the output. So the script is
 * idempotent — run it five times and the fifth result equals the first — instead of compounding
 * a little more contrast every time somebody re-runs it, which is how a set of photographs ends
 * up looking processed.
 *
 * THE COPY IS NODE, NOT `cp`. `cp` is aliased to `cp -i` on this machine and `cp -f` still
 * prompts, so a copy in a script silently does not happen and the "originals" are whatever was
 * there before. That has cost a session before.
 *
 * THE TARGET IS MEASURED, NOT CHOSEN. --measure prints every photograph's mean luma and its
 * red/blue ratio; the grade moves each one toward the MEDIAN of the set rather than toward a
 * number somebody liked. A median keeps the look Josue's customers already compliment; a chosen
 * number would be this file having an opinion about his business.
 *
 * THE ONE CROP IT DOES MAKE, and why it is not an editorial decision. `BeforeAfter.astro`
 * overlays a pair and drags a divider across them; a pair of different shapes cannot be
 * compared honestly, and the reader sees the edge of one photograph moving over the other.
 * Where a pair disagrees, the wider one is centre-cropped to its partner's ratio. That is a
 * geometric fix to make two pictures of the same yard comparable — it is not a choice about
 * what to show, and the amount is reported. Everything else keeps its own shape.
 *
 * WHAT IT DOES NOT DO: it does not retouch, sharpen, saturate, or generate. Two linear moves,
 * both bounded, from the original every time.
 */
import { readdirSync, existsSync, mkdirSync, copyFileSync, statSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const SRC = 'src/assets/photos';
const ORIG = 'assets-originals/photos';
const measureOnly = process.argv.includes('--measure');

/** Mean luma (0-255) and the red/blue ratio, which is what "temperature" is to a camera. */
async function measure(file) {
  const img = sharp(file);
  const meta = await img.metadata();
  const stats = await img.stats();
  const [r, g, b] = stats.channels;
  return {
    file: path.basename(file),
    w: meta.width, h: meta.height,
    ratio: Number((meta.width / meta.height).toFixed(3)),
    // Rec. 601 luma, the same weighting a phone's own auto-exposure uses.
    luma: Number((0.299 * r.mean + 0.587 * g.mean + 0.114 * b.mean).toFixed(1)),
    rb: Number((r.mean / b.mean).toFixed(3)),
    bytes: statSync(file).size,
  };
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

// ---- 1. the originals, copied once and never again -------------------------------------
if (!existsSync(ORIG)) mkdirSync(ORIG, { recursive: true });
const names = readdirSync(SRC).filter((f) => /\.(jpe?g|png)$/i.test(f)).sort();
let copied = 0;
for (const n of names) {
  const dest = path.join(ORIG, n);
  if (!existsSync(dest)) { copyFileSync(path.join(SRC, n), dest); copied++; }
}
console.log(`${names.length} photographs · ${copied} newly preserved in ${ORIG}/ · ${readdirSync(ORIG).length} originals held`);

// ---- 2. measure the originals ----------------------------------------------------------
const before = [];
for (const n of names) before.push(await measure(path.join(ORIG, n)));

const targetLuma = median(before.map((m) => m.luma));
const targetRb = median(before.map((m) => m.rb));
const ratios = [...new Set(before.map((m) => m.ratio))];

console.log(`\ntarget, from the set's own median: luma ${targetLuma.toFixed(1)}, red/blue ${targetRb.toFixed(3)}`);
console.log(`aspect ratios present: ${ratios.join(', ')}`);
console.log('\nfile                                   w×h        ratio   luma    r/b');
for (const m of before) {
  const flagL = Math.abs(m.luma - targetLuma) > 12 ? ' <- exposure' : '';
  const flagT = Math.abs(m.rb - targetRb) > 0.08 ? ' <- temperature' : '';
  console.log(`  ${m.file.padEnd(36)} ${String(m.w).padStart(4)}×${String(m.h).padEnd(4)}  ${m.ratio.toFixed(3)}  ${String(m.luma).padStart(5)}  ${m.rb.toFixed(3)}${flagL}${flagT}`);
}

// A before/after pair that is not the same shape cannot be compared honestly, and the draggable
// comparison in BeforeAfter.astro overlays them. This is a report, not a crop: fixing it means
// deciding what to lose from a real photograph, which is a person's call.
const pairs = new Map();
for (const m of before) {
  const stem = m.file.replace(/-(before|after)\.\w+$/i, '');
  if (stem === m.file) continue;
  (pairs.get(stem) ?? pairs.set(stem, []).get(stem)).push(m);
}
const mismatched = [...pairs.entries()].filter(([, v]) => v.length === 2 && Math.abs(v[0].ratio - v[1].ratio) > 0.02);
console.log(mismatched.length
  ? `\n${mismatched.length} before/after pair(s) differ in shape: ${mismatched.map(([k]) => k).join(', ')}`
  : `\nall ${pairs.size} before/after pairs share a shape`);

/** For a mismatched pair, the target ratio (the partner's) keyed by file. */
const cropTo = new Map();
for (const [stem, v] of mismatched) {
  const [wide, narrow] = v[0].ratio > v[1].ratio ? [v[0], v[1]] : [v[1], v[0]];
  cropTo.set(wide.file, narrow.ratio);
  console.log(`  ${stem}: ${wide.file} is ${wide.ratio} against ${narrow.file} at ${narrow.ratio} — centre-cropping the wider one`);
}

if (measureOnly) process.exit(0);

// ---- 3. grade, from the originals ------------------------------------------------------
// Two moves only, both linear and both bounded. `modulate.brightness` is a multiplier on
// lightness; `tint` pulls white balance. Anything more — curves, saturation, sharpening — starts
// making the photograph into something that was not in front of the camera.
const CLAMP = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const after = [];
for (const m of before) {
  // WHITE BALANCE AS A PER-CHANNEL GAIN, not as a tint overlay.
  //
  // The first version nudged `sharp.tint()` by up to ±6 units and closed the temperature
  // spread from 0.479 to 0.256 — better, and not "one temperature", which is what P15 §6.1
  // asked for. `tint` blends toward a colour; what a camera's white balance actually does is
  // scale the red and blue channels against green. So: scale them, by exactly the amount that
  // puts this photograph's red/blue ratio on the set's median, splitting the correction
  // between the two channels so the overall exposure barely moves.
  const want = targetRb / m.rb;
  const rMul = CLAMP(Math.sqrt(want), 0.88, 1.14);
  const bMul = CLAMP(1 / Math.sqrt(want), 0.88, 1.14);
  // Exposure after the channels, on the luma the correction leaves behind.
  const brightness = CLAMP(targetLuma / m.luma, 0.85, 1.18);

  const src = path.join(ORIG, m.file);
  const dest = path.join(SRC, m.file);
  let pipe = sharp(src)
    .linear([rMul, 1, bMul], [0, 0, 0])
    .modulate({ brightness });
  // The pair fix: take the middle, lose the same from each side.
  const target = cropTo.get(m.file);
  if (target) {
    const w = Math.round(m.h * target);
    pipe = pipe.extract({ left: Math.round((m.w - w) / 2), top: 0, width: w, height: m.h });
    console.log(`  cropping ${m.file}: ${m.w}px -> ${w}px wide, ${Math.round((1 - w / m.w) * 100)}% off the sides`);
  }
  // Re-encode at a quality honest about what these are: web photographs behind astro:assets,
  // which resizes and converts them again anyway.
  await pipe.jpeg({ quality: 86, mozjpeg: true }).toFile(dest + '.tmp');
  const { renameSync } = await import('node:fs');
  renameSync(dest + '.tmp', dest);
  const clamped = [
    brightness === 0.85 || brightness === 1.18 ? 'exposure' : null,
    rMul === 0.88 || rMul === 1.14 ? 'temperature' : null,
  ].filter(Boolean);
  after.push({ ...(await measure(dest)), brightness: Number(brightness.toFixed(3)), drift: Number(rMul.toFixed(3)), clamped });
}

console.log('\ngraded:');
console.log('file                                   luma    r/b    ×bright  ×red   bytes');
let saved = 0;
for (let i = 0; i < after.length; i++) {
  const a = after[i], b = before[i];
  saved += b.bytes - a.bytes;
  console.log(`  ${a.file.padEnd(36)} ${String(a.luma).padStart(5)}  ${a.rb.toFixed(3)}  ${a.brightness.toFixed(3)}  ${String(a.drift).padStart(5)}  ${(a.bytes / 1024).toFixed(0)}KB`);
}
const spreadBefore = Math.max(...before.map((m) => m.luma)) - Math.min(...before.map((m) => m.luma));
const spreadAfter = Math.max(...after.map((m) => m.luma)) - Math.min(...after.map((m) => m.luma));
const tempBefore = Math.max(...before.map((m) => m.rb)) - Math.min(...before.map((m) => m.rb));
const tempAfter = Math.max(...after.map((m) => m.rb)) - Math.min(...after.map((m) => m.rb));
console.log(`\nluma spread across the set:  ${spreadBefore.toFixed(1)} -> ${spreadAfter.toFixed(1)}`);
console.log(`temperature spread:          ${tempBefore.toFixed(3)} -> ${tempAfter.toFixed(3)}`);
console.log(`bytes:                       ${(saved / 1024).toFixed(0)}KB saved`);

// THE ONES THE CLAMPS HELD BACK, named rather than hidden in the residual spread. The bounds
// (×0.85–1.18 exposure, ×0.88–1.14 per channel) exist so a correction cannot damage a
// photograph — pulling an 87-luma picture to 124 would wash it out and lift its noise. Where a
// photograph is still outside the target, it is because it is genuinely darker or warmer than
// the set, and that is a fact about the photograph rather than a fault in the grade.
const held = after.filter((a) => a.clamped.length);
console.log(held.length
  ? `\nheld at the bounds (still outside the target, deliberately):\n${held.map((a) => `      ${a.file.padEnd(34)} ${a.clamped.join(' + ')}`).join('\n')}`
  : '\nno photograph needed a correction the bounds would not allow');
