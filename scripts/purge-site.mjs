/**
 * Purge the public pages from Vercel's CDN, the way an admin save does, for a change made OUTSIDE
 * the admin (scripts/set-setting.mjs, a migration, a hand-run SQL fix).
 *
 *   node scripts/purge-site.mjs
 *
 * The admin purges by itself (api/admin.ts -> server/lib/site-cache.ts). A row changed any other way
 * stays behind the cached HTML until something purges it, so this is that something. It deletes the
 * tag (dangerously-delete, the same choice site-cache.ts makes) so the next visitor gets the new rows
 * at once rather than one more stale copy. The tag is read from site-cache.ts so there is one name.
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

export function purgeSite() {
  const tag = /SITE_CACHE_TAG = '([^']+)'/.exec(readFileSync(new URL('../server/lib/site-cache.ts', import.meta.url), 'utf8'))[1];
  execFileSync('npx', ['vercel', 'cache', 'dangerously-delete', '--tag', tag, '--yes', '--scope', 'benamtechs-projects'],
    { stdio: ['ignore', 'pipe', 'pipe'], timeout: 120_000, cwd: new URL('..', import.meta.url).pathname });
  return tag;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try { console.log(`  purged the CDN tag ${purgeSite()} on the scoopdogg project`); }
  catch (e) { console.error(`  purge failed: ${String(e.stderr || e.message).split('\n').filter(Boolean).slice(-2).join(' | ')}`); process.exit(1); }
}
