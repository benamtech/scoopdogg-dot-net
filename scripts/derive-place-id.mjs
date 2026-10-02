/**
 * Derive Josue's Google Place ID — and therefore his "write a review" link — from the Maps link
 * his own site already publishes.
 *
 *   node scripts/derive-place-id.mjs
 *   node scripts/derive-place-id.mjs --check   # also fetch the write-review URL and report the status
 *
 * WHY THIS IS A SCRIPT AND NOT A NOTE. Migration 028 seeds a URL containing a 27-character
 * opaque string. A number nobody can re-derive is a number nobody can check, and this project
 * has been bitten by exactly that (the corrupted stall-fee digits on the festival job, the two
 * homes for platform_fee_bps). Running this prints the whole chain, so the row in the database
 * can be audited against Josue's own site in one command.
 *
 * THE CHAIN.
 *
 *   1. The site's footer and every /areas page link https://maps.app.goo.gl/9gB4PZfqtLwkHhQ3A.
 *   2. That resolves to a Maps place URL carrying `!1s0x<hi>:0x<lo>` — Google's feature id.
 *   3. A Place ID is base64url(protobuf) where the protobuf is one length-delimited field 1
 *      containing two fixed64s: field 1 = hi, field 2 = lo, both little-endian. In bytes:
 *          0a <len> 09 <hi as 8 LE bytes> 11 <lo as 8 LE bytes>
 *   4. https://search.google.com/local/writereview?placeid=<that> opens the review composer.
 *
 * Step 3 is checked both ways: the bytes are built from the feature id AND the resulting string
 * is decoded back, and the two halves must match. A one-way derivation could be wrong in a way
 * that still produced a plausible-looking string.
 *
 * The feature id is NOT hardcoded as a fact about the business — it is read from the live page
 * when the network allows, and falls back to the value recorded in migration 028 with a note
 * saying which one was used.
 */

/** The link Josue's own site publishes. Changing this means his profile moved. */
const SHARE = 'https://maps.app.goo.gl/9gB4PZfqtLwkHhQ3A';
/** What migration 028 recorded on 2026-09-22, used only when the network is unavailable. */
const RECORDED = { hi: 0x80e9ad5095f467c7n, lo: 0xa340946c96acfa2fn };
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';

const le64 = (v) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(v); return b; };

function placeId(hi, lo) {
  const inner = Buffer.concat([Buffer.from([0x09]), le64(hi), Buffer.from([0x11]), le64(lo)]);
  const body = Buffer.concat([Buffer.from([0x0a, inner.length]), inner]);
  return body.toString('base64url');
}

/** Decode a Place ID back to its two halves, so the derivation is checked in both directions. */
function halves(id) {
  const b = Buffer.from(id, 'base64url');
  if (b[0] !== 0x0a || b[2] !== 0x09 || b[11] !== 0x11 || b.length < 20) return null;
  return { hi: b.readBigUInt64LE(3), lo: b.readBigUInt64LE(12) };
}

async function featureIdFromTheSite() {
  const r = await fetch(SHARE, { headers: { 'User-Agent': UA }, redirect: 'follow' });
  const url = r.url ?? '';
  const m = /!1s0x([0-9a-f]{16}):0x([0-9a-f]{16})/i.exec(decodeURIComponent(url));
  if (!m) throw new Error(`no feature id in the resolved URL: ${url.slice(0, 160)}`);
  return { hi: BigInt(`0x${m[1]}`), lo: BigInt(`0x${m[2]}`), url };
}

let src = 'live', fid, resolved = null;
try {
  const got = await featureIdFromTheSite();
  fid = { hi: got.hi, lo: got.lo }; resolved = got.url;
} catch (e) {
  src = `recorded (live read failed: ${e.message})`;
  fid = RECORDED;
}

const id = placeId(fid.hi, fid.lo);
const back = halves(id);
const roundTrips = back && back.hi === fid.hi && back.lo === fid.lo;
const review = `https://search.google.com/local/writereview?placeid=${id}`;

console.log(`source          ${src}`);
if (resolved) console.log(`resolved        ${resolved.slice(0, 120)}…`);
console.log(`feature id      0x${fid.hi.toString(16).padStart(16, '0')}:0x${fid.lo.toString(16).padStart(16, '0')}`);
console.log(`place id        ${id}`);
console.log(`round-trips     ${roundTrips ? 'yes' : 'NO — the derivation is wrong'}`);
console.log(`write a review  ${review}`);

if (process.argv.includes('--check')) {
  try {
    const r = await fetch(review, { headers: { 'User-Agent': UA }, redirect: 'follow' });
    const signin = /accounts\.google\.com/.test(r.url ?? '');
    console.log(`fetch           ${r.status}${signin ? ' (sent to Google sign-in, which is correct when signed out)' : ''}`);
  } catch (e) {
    console.log(`fetch           failed: ${e.message}`);
  }
}

process.exit(roundTrips ? 0 : 1);
