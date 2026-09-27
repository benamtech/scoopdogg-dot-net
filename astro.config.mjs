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
    /**
     * A SITEMAP IS A LIST OF PAGES YOU ARE ASKING TO HAVE INDEXED, so a noindex page in it is
     * the site contradicting itself to a crawler.
     *
     * This filter only ever excluded /admin, and scripts/visibility-ledger.mjs found the rest on
     * its first run: /account, /invite and /book/complete all serve
     * `<meta name="robots" content="noindex, nofollow">` and all three were advertised. They are
     * the same three gates/orphan-pages.mjs already declares private — a customer reaches
     * /invite from a one-time token in an email and /book/complete by redirect from Stripe, and
     * neither is a page anybody should arrive at cold.
     *
     * NO `lastmod`, deliberately. @astrojs/sitemap emits it only when given a lastmod or
     * serialize option, and the only honest per-page value would come from git history — which a
     * hosted build does not have, because Vercel builds from a tarball with no repository. A
     * build timestamp stamped on every page would change every URL's lastmod on every deploy and
     * tell crawlers everything changed when nothing did. The ledger reports this line as
     * unmeasurable rather than printing a number that means nothing.
     */
    sitemap({
      filter: (page) => {
        const p = new URL(page).pathname.replace(/\/$/, '');
        return !p.startsWith('/admin') && !['/account', '/invite', '/book/complete'].includes(p);
      },
    }),
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
