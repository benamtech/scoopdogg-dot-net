// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import tailwind from '@astrojs/tailwind';
import vercel from '@astrojs/vercel';

// ON DEMAND, with the Vercel adapter (2026-09-29).
//
// It was static with no adapter, for two reasons that were both measured and both still hold:
//  1. Every one of the 71 URLs on the predecessor site served the same empty shell because a
//     bolted-on prerenderer was skipped in production. On-demand rendering keeps real HTML per
//     route: the server renders the page, the browser renders nothing.
//  2. Root api/ functions stay Vercel's. Measured 2026-09-27 in a scratch worktree and again on
//     this branch: @astrojs/vercel 8.2.11 keeps all eight root api/ functions and their rewrites.
//
// Static broke the rule that matters more: anything Josue edits is live on the public site in
// seconds, with no rebuild. So every page renders from the live rows (src/middleware.ts) and the
// HTML is held at the CDN until an admin save purges it (server/lib/site-cache.ts). The gates that
// read built HTML read pages this server rendered (scripts/render-pages.mjs), not a static export.
export default defineConfig({
  site: 'https://scoopdogg.net',
  output: 'server',
  // imageService: Vercel's image CDN resizes and converts at the edge and caches the result, so no
  // image request runs our function (without it, every <Image> became /_image, served by sharp inside
  // the page function). The source files are kept small too: see assets-originals/art.
  adapter: vercel({ imageService: true }),
  integrations: [
    react(),
    tailwind({ applyBaseStyles: false }),
  ],
  vite: {
    resolve: {
      alias: {
        // His components import react-router-dom. Astro does real navigation, so the
        // router is replaced by a ~60-line shim and no component is edited.
        'react-router-dom': new URL('./src/shims/react-router-dom.tsx', import.meta.url).pathname,
      },
    },
  },
});
