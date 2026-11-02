import type { APIRoute } from 'astro';
import { okfPolicies } from '../../lib/okf';

export const GET: APIRoute = () => new Response(okfPolicies(Date.now()), { headers: { 'Content-Type': 'text/markdown; charset=utf-8' } });
