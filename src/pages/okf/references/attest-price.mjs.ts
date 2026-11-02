import type { APIRoute } from 'astro';
import { ATTESTER_SOURCE } from '../../../lib/okf';

export const GET: APIRoute = () => new Response(ATTESTER_SOURCE, { headers: { 'Content-Type': 'text/javascript; charset=utf-8' } });
