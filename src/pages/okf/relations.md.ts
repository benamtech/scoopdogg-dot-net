import type { APIRoute } from 'astro';
import { okfRelations } from '../../lib/okf';

export const GET: APIRoute = () => new Response(okfRelations(Date.now()), { headers: { 'Content-Type': 'text/markdown; charset=utf-8' } });
