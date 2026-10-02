/**
 * THE SITEMAP, FROM THE LIVE ROWS. A sitemap is the list of pages we ask to have indexed, so it
 * is built from the same rows that decide which pages exist: a service, area or question the
 * owner adds is listed on the next render, and one he retires stops being listed.
 *
 * It replaced @astrojs/sitemap (2026-09-29), which only sees pages that exist at build.
 *
 * PRIVATE PAGES ARE NEVER LISTED. /account, /invite, /book/complete and /quote serve
 * `noindex, nofollow`: a customer reaches /invite from a one-time token in an email and
 * /book/complete by redirect from Stripe, and neither is a page anybody should arrive at cold.
 * gates/orphan-pages.mjs declares the same set private. /admin is an application.
 *
 * NO `lastmod`. The only honest per-page value would come from the row's own updated_at, and a
 * stamp that changes on every render tells crawlers everything changed when nothing did.
 * URLs are canonical: no trailing slash, the same form every page's <link rel="canonical"> uses.
 */
import { services, areas } from './catalog';
import { questions } from './questions';
import { ARTICLES } from './articles';
import { SITE_URL } from './constants';

export const PRIVATE = ['/404', '/account', '/invite', '/book/complete', '/quote'];

// Every top-level page file, so a page added to src/pages is listed without anyone remembering to.
const files = Object.keys(import.meta.glob('../pages/**/*.astro'));

export function sitemapPaths(): string[] {
  const fixed = files
    .map((f) => f.replace(/^\.\.\/pages/, '').replace(/\.astro$/, '').replace(/\/index$/, '') || '/')
    .filter((p) => !p.includes('[') && !p.startsWith('/admin') && !PRIVATE.includes(p));
  const dynamic = [
    ...services.map((s) => `/services/${s.slug}`),
    ...areas.map((a) => `/areas/${a.slug}`),
    ...questions().map((q) => `/questions/${q.slug}`),
    ...ARTICLES.map((a) => `/resources/${a.slug}`),
  ];
  return [...new Set([...fixed, ...dynamic])].sort();
}

export function sitemapXml(): string {
  const urls = sitemapPaths().map((p) => `<url><loc>${SITE_URL}${p === '/' ? '/' : p}</loc></url>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`;
}
