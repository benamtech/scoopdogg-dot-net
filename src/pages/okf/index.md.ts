import type { APIRoute } from 'astro';
import { okfRootIndex } from '../../lib/okf';

export const GET: APIRoute = () => new Response(okfRootIndex(), { headers: { 'Content-Type': 'text/markdown; charset=utf-8' } });
