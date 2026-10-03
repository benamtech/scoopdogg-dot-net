/**
 * /api/photo/<id> — serve one completion photo.
 *
 * THIS IS A CAPABILITY URL and migration 029 says so out loud: the id is a uuid v4, 122 bits of
 * randomness, and holding the link is the permission. There is no session check, because the
 * two places this URL has to work are a customer's email and their /account page, and a photo
 * that only renders behind an admin login is a photo nobody sees. It is the same standard as
 * the magic sign-in link the same customer already gets, applied to a picture of a clean lawn.
 *
 * THREE THINGS KEEP IT FROM LEAKING FURTHER THAN THAT:
 *
 *   - `X-Robots-Tag: noindex, noimageindex, nofollow`. A capability URL that reaches a search
 *     index is not a capability any more, and robots.txt cannot express "do not index an image
 *     you were linked to". The header can.
 *   - No listing. There is no route that enumerates ids, and `forVisit()` is server-side only.
 *   - A uuid shape check before the query, so this endpoint is not a place to probe the database
 *     with arbitrary strings.
 *
 * CACHING. `immutable`, one year: the bytes at an id never change, because a new photo gets a
 * new row and a new id. Retention deletes them, and after that the id 404s — which is the
 * correct answer, and why `prune()` also clears the URLs off the visit rather than leaving a
 * completed visit pointing at dead links.
 */
import { get } from '../server/lib/photos.js';
import { safeError, type ApiRequest, type ApiResponse } from '../server/lib/http.js';

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.statusCode = 405;
    res.setHeader('Allow', 'GET, HEAD');
    return res.end('Method not allowed');
  }

  const url = new URL(req.url || '/', 'https://local.test');
  // The rewrite in vercel.json passes the matched segment as ?id=. The path is read as a
  // fallback so the route also works when called directly in dev.
  const id = url.searchParams.get('id') || url.pathname.split('/').filter(Boolean).pop() || '';

  try {
    const photo = await get(id);
    if (!photo) {
      res.statusCode = 404;
      res.setHeader('Cache-Control', 'no-store');
      return res.end('Not found');
    }
    res.statusCode = 200;
    res.setHeader('Content-Type', photo.mime);
    res.setHeader('Content-Length', String(photo.bytes.length));
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('X-Robots-Tag', 'noindex, noimageindex, nofollow');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.method === 'HEAD') return res.end();
    return res.end(photo.bytes);
  } catch (e) {
    safeError('api:photo', e);
    res.statusCode = 500;
    res.setHeader('Cache-Control', 'no-store');
    return res.end('Error');
  }
}
