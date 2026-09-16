/**
 * Demo mode, as the built pages see it.
 *
 * ONE SETTING, FOUR SURFACES. `demo.mode` in the database gates mail (server/lib/notify.ts),
 * the client pages and the booking journey (this file), and Stripe. Four half-modes behind
 * four switches is how one of them gets left on.
 *
 * The pages read it from content/demo.json rather than from the database, because the site
 * is statically built: there is no server rendering a page when a crawler asks for it, so
 * the banner and the `noindex` have to be in the bytes. scripts/pull-demo-state.mjs writes
 * that file as build step one and fails the build rather than guessing - a demo build with
 * no banner is indistinguishable from the live site.
 *
 * Consequence, and it is the right one: turning demo mode on or off is a setting change
 * plus a publish, the same shape as changing a price.
 */
import demoJson from '../../content/demo.json';

export type DemoState = {
  mode: boolean;
  banner_text: string;
  /** Where the value came from, so a screen can say how it knows. */
  source: string;
  pulled_at: string | null;
};

const state = demoJson as DemoState;

/** True when this build was published with demo mode on. */
export const DEMO_MODE: boolean = state.mode === true;

/** The words on the banner. Empty when demo mode is off. */
export const DEMO_BANNER_TEXT: string = DEMO_MODE ? state.banner_text : '';

export const DEMO_STATE: DemoState = state;
