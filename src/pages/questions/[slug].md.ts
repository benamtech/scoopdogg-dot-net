/** The markdown twin of each question page, for agents: the answer and the facts, no furniture. */
import type { APIRoute } from 'astro';
import { questions, questionBySlug, questionMarkdown } from '../../lib/questions';
import { SITE_URL } from '../../lib/constants';

export function getStaticPaths() {
  return questions().map((q) => ({ params: { slug: q.slug } }));
}

export const GET: APIRoute = ({ params }) =>
  new Response(questionMarkdown(questionBySlug(params.slug!)!, SITE_URL), {
    headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
  });
