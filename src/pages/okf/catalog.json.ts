import type { APIRoute } from 'astro';
import { okfCatalogJson } from '../../lib/okf';

export const GET: APIRoute = () => new Response(JSON.stringify(okfCatalogJson(), null, 1), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
