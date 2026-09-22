/**
 * Turn whatever a phone camera hands us into something the server will accept.
 *
 * THE RESIZE IS HERE AND NOT ON THE SERVER, and `server/lib/photos.ts` says why: putting sharp in
 * the function bundle is ~30MB to solve a problem a canvas already solves for free. It also means
 * the bytes are small BEFORE they cross a phone's uplink, which is the connection that matters —
 * a 4MB original over a yard's worth of signal is the difference between a photo and a spinner.
 *
 * FOUR THINGS THIS HAS TO GET RIGHT, and three of them are only visible on a real phone:
 *
 *   1. ORIENTATION. A photo taken in portrait carries its rotation in EXIF, and drawing it to a
 *      canvas naively produces a sideways image. `createImageBitmap(blob, { imageOrientation:
 *      'from-image' })` applies it; without that flag every portrait completion photo is wrong.
 *   2. THE CAP IS ON BYTES, NOT PIXELS. 1600px is usually 150-400KB and occasionally is not — a
 *      busy lawn is a lot of high-frequency detail. So quality steps down until it fits, and the
 *      function reports failure rather than returning something the server will reject.
 *   3. JPEG, ALWAYS. HEIC off an iPhone is not in the server's mime set; a canvas re-encode makes
 *      the format question go away for every device at once.
 *   4. IT MUST NOT HOLD THE BITMAP. `close()` in a finally: a crew member doing twenty stops on
 *      one page load will otherwise accumulate twenty decoded images.
 */

/** Matches `visit.photo_max_bytes`'s seeded value. The SERVER is the enforcer; this is the fit. */
const DEFAULT_MAX_BYTES = 900_000;
const MAX_EDGE = 1600;
const QUALITIES = [0.82, 0.7, 0.6, 0.5];

export type CapturedPhoto = { dataUrl: string; bytes: number; width: number; height: number };

export async function prepareForUpload(file: File, maxBytes = DEFAULT_MAX_BYTES): Promise<CapturedPhoto> {
  if (!file.type.startsWith('image/')) throw new Error('That is not an image.');

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    // Older Safari does not take the options bag. Falling back keeps the feature working and
    // loses only the auto-rotation, which is better than refusing the photo.
    bitmap = await createImageBitmap(file);
  }

  try {
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('This browser cannot resize the photo.');
    ctx.drawImage(bitmap, 0, 0, w, h);

    for (const q of QUALITIES) {
      const dataUrl = canvas.toDataURL('image/jpeg', q);
      // A data URL is base64, which is 4 bytes per 3. This is the DECODED size, which is the
      // number `visit.photo_max_bytes` names and the number the server will check.
      const bytes = Math.ceil((dataUrl.length - dataUrl.indexOf(',') - 1) * 3 / 4);
      if (bytes <= maxBytes) return { dataUrl, bytes, width: w, height: h };
    }
    throw new Error('That photo is too large even after resizing. Try another one.');
  } finally {
    bitmap.close?.();
  }
}
