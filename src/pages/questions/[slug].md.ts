/** The markdown twin of each question page, for agents: the answer and the facts, no furniture. */
import type { APIRoute } from 'astro';
import { questionBySlug, questionMarkdown } from '../../lib/questions';
import { SITE_URL } from '../../lib/constants';

export const GET: APIRoute = ({ params }) => {
  const q = questionBySlug(params.slug!);
  if (!q) return new Response(null, { status: 404 });
  return new Response(questionMarkdown(q, SITE_URL), {
    headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
  });
};
