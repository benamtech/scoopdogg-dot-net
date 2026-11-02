import type { APIRoute } from 'astro';
import { okfPriceComputation } from '../../../lib/okf';

export const GET: APIRoute = () => new Response(okfPriceComputation(Date.now()), { headers: { 'Content-Type': 'text/markdown; charset=utf-8' } });
