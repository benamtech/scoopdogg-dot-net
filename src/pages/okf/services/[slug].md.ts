import type { APIRoute } from 'astro';
import { okfService } from '../../../lib/okf';

export const GET: APIRoute = ({ params }) => {
  const body = okfService(params.slug!, Date.now());
  return body ? new Response(body, { headers: { 'Content-Type': 'text/markdown; charset=utf-8' } }) : new Response(null, { status: 404 });
};
