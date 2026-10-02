/**
 * Search Console for scoopdogg.net, with no key file and no one signing in.
 *
 *   node scripts/search-console.mjs verify    # prove ownership, add Ben as owner, submit the sitemap
 *   node scripts/search-console.mjs report    # queries, clicks, impressions, position — last 28 days
 *
 * HOW IT AUTHENTICATES. The Google Cloud org blocks service-account key files
 * (iam.disableServiceAccountKeyCreation), and a key file is a secret that can leak anyway. So the
 * service account search-console@amtech-search-console.iam.gserviceaccount.com is IMPERSONATED:
 * the signed-in gcloud user (ben@amtechai.com, roles/iam.serviceAccountTokenCreator on it) mints a
 * one-hour token. The token goes from gcloud into this process and is never printed.
 *
 * VERIFY NEEDS THE LIVE SITE TO CARRY THE TAG. Base.astro prints
 * <meta name="google-site-verification"> from settings.google.site_verification, and Google reads
 * it from https://scoopdogg.net/ — so it succeeds once the branch carrying it is in production.
 */
import { execFileSync } from 'node:child_process';

const SA = 'search-console@amtech-search-console.iam.gserviceaccount.com';
const SITE = 'https://scoopdogg.net/';
const OWNER = 'ben@amtechai.com';
// In GitHub Actions the token arrives already minted: google-github-actions/auth exchanges the
// workflow's own OIDC token for one as this service account (keyless Workload Identity Federation,
// pool `github`, limited to this repository) and hands it over as SEARCH_CONSOLE_TOKEN. On a laptop
// the signed-in gcloud user impersonates the service account, as before.
const token = process.env.SEARCH_CONSOLE_TOKEN || execFileSync('gcloud', ['auth', 'print-access-token', `--impersonate-service-account=${SA}`,
  '--scopes=https://www.googleapis.com/auth/siteverification,https://www.googleapis.com/auth/webmasters'],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
const api = async (url, init = {}) => {
  const r = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers || {}) } });
  const text = await r.text();
  let body; try { body = JSON.parse(text); } catch { body = text; }
  if (!r.ok) throw new Error(`${r.status} ${typeof body === 'object' ? body.error?.message : body}`);
  return body;
};
const enc = encodeURIComponent(SITE);

const cmd = process.argv[2];
if (cmd === 'verify') {
  const live = await (await fetch(SITE)).text();
  if (!/name="google-site-verification"/.test(live)) {
    console.log(`not yet: ${SITE} does not carry the verification tag (production has to include the branch that adds it)`);
    process.exit(2);
  }
  const res = await api('https://www.googleapis.com/siteVerification/v1/webResource?verificationMethod=META', {
    method: 'POST', body: JSON.stringify({ site: { type: 'SITE', identifier: SITE } }),
  });
  await api(`https://www.googleapis.com/siteVerification/v1/webResource/${encodeURIComponent(res.id)}`, {
    method: 'PUT', body: JSON.stringify({ site: res.site, owners: [...new Set([...(res.owners ?? []), OWNER])] }),
  });
  await api(`https://www.googleapis.com/webmasters/v3/sites/${enc}`, { method: 'PUT' });
  await api(`https://www.googleapis.com/webmasters/v3/sites/${enc}/sitemaps/${encodeURIComponent(`${SITE}sitemap-index.xml`)}`, { method: 'PUT' });
  console.log(`verified ${SITE}; owners include ${OWNER} (it now shows in that account's Search Console); sitemap submitted`);
} else if (cmd === 'report') {
  const end = new Date(Date.now() - 2 * 86400_000).toISOString().slice(0, 10);
  const start = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
  const r = await api(`https://www.googleapis.com/webmasters/v3/sites/${enc}/searchAnalytics/query`, {
    method: 'POST', body: JSON.stringify({ startDate: start, endDate: end, dimensions: ['query'], rowLimit: 25 }),
  });
  console.log(`${start} to ${end}`);
  for (const row of r.rows ?? []) console.log(`${String(row.clicks).padStart(4)} clicks ${String(row.impressions).padStart(6)} impr  pos ${row.position.toFixed(1).padStart(5)}  ${row.keys[0]}`);
  if (!r.rows?.length) console.log('no data yet (Search Console fills in over a few days after verification)');
} else {
  console.log('usage: search-console.mjs verify | report');
  process.exit(1);
}
