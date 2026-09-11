// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import tailwind from '@astrojs/tailwind';
import sitemap from '@astrojs/sitemap';

// STATIC on purpose, and with NO Vercel adapter.
//
// Two reasons, both measured:
//  1. Every one of the 71 URLs on the live site serves the same 6,962-byte empty shell
//     because a bolted-on prerenderer was skipped in production. Static output makes
//     real HTML per route the default rather than a build step that can be turned off.
//  2. Without an adapter Astro never creates .vercel/output, which leaves the `api/`
//     directory to Vercel. That is what lets McGrath's Node-shaped handlers be reused
//     verbatim instead of rewritten as Astro endpoints.
export default defineConfig({
  site: 'https://scoopdogg.net',
  output: 'static',
  outDir: './dist',
  integrations: [
    react(),
    tailwind({ applyBaseStyles: false }),
    // /admin/* is noindex and robots-disallowed, so advertising it in the sitemap would
    // be telling crawlers to go where we just told them not to.
    sitemap({ filter: (page) => !new URL(page).pathname.startsWith('/admin') }),
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
