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
  //
  // THE WIDTH LIST IS NOT OPTIONAL. Vercel's image CDN serves only the widths named here, and the
  // adapter silently drops any `widths={[...]}` value that is not on the list; with none left it
  // falls back to the width nearest the SOURCE file. Measured 2026-10-02: a 160px cartoon asked
  // for [160, 320], both were dropped, and it was served at 1080px, quality 100, 335KB. The
  // adapter's default list starts at 640. So the list below carries every width a component asks
  // for, and gates/image-widths.mjs fails the build when a component asks for one that is not
  // here, or leaves `quality` to the adapter's default of 100.
  adapter: vercel({
    imageService: true,
    imagesConfig: {
      sizes: [160, 176, 200, 260, 320, 352, 380, 390, 400, 480, 520, 600, 640, 750, 800, 828, 960, 1080, 1200, 1280, 1920],
      domains: [],
      formats: ['image/webp'],
      minimumCacheTTL: 2678400,
    },
  }),
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
