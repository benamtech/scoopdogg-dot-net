import type { APIRoute } from 'astro';
import { okfAreas } from '../../lib/okf';

export const GET: APIRoute = () => new Response(okfAreas(Date.now()), { headers: { 'Content-Type': 'text/markdown; charset=utf-8' } });
