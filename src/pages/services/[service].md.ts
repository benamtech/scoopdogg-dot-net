/** The markdown twin of each service page, for agents: what it is, the price, what goes with it. */
import type { APIRoute } from 'astro';
import { serviceMarkdown } from '../../lib/okf';

export const GET: APIRoute = ({ params }) => {
  const body = serviceMarkdown(params.service!);
  return body ? new Response(body, { headers: { 'Content-Type': 'text/markdown; charset=utf-8' } }) : new Response(null, { status: 404 });
};
