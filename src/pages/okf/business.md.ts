import type { APIRoute } from 'astro';
import { okfBusiness } from '../../lib/okf';

export const GET: APIRoute = () => new Response(okfBusiness(Date.now()), { headers: { 'Content-Type': 'text/markdown; charset=utf-8' } });
