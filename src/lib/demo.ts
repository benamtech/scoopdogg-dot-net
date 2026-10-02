/**
 * Demo mode, as the rendered pages see it.
 *
 * ONE SETTING, FOUR SURFACES. `demo.mode` in the database gates mail (server/lib/notify.ts),
 * the client pages and the booking journey (this file), and Stripe. Four half-modes behind
 * four switches is how one of them gets left on.
 *
 * The pages read it from the rows on each render: src/middleware.ts reads `demo.mode` with the
 * catalog (server/lib/public-catalog.ts) and calls `setDemo()`. The banner and the `noindex` are
 * in the HTML a crawler receives, and turning demo mode on or off reaches every page as soon as
 * the save purges the page cache. No rebuild, no publish (2026-09-29; until then it was baked in
 * at build from content/demo.json).
 *
 * Live bindings, like src/lib/catalog.ts: importers keep `import { DEMO_MODE }` and see the
 * value for the current render.
 */
export type DemoState = {
  mode: boolean;
  banner_text: string;
  /** Where the value came from, so a screen can say how it knows. */
  source: string;
  pulled_at: string | null;
};

/** True when this render has demo mode on. */
export let DEMO_MODE = false;

/** The words on the banner. Empty when demo mode is off. */
export let DEMO_BANNER_TEXT = '';

export let DEMO_STATE: DemoState = { mode: false, banner_text: '', source: 'unset', pulled_at: null };

export function setDemo(state: DemoState) {
  DEMO_STATE = state;
  DEMO_MODE = state.mode === true;
  DEMO_BANNER_TEXT = DEMO_MODE ? state.banner_text : '';
}
