import type { APIRoute } from 'astro';
import { sitemapXml } from '../lib/sitemap';

// Rendered from the live rows (src/lib/sitemap.ts says why and what is left out).
export const GET: APIRoute = () =>
  new Response(sitemapXml(), { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
