/**
 * RETIRED. Nothing on the public site may talk to a database from the browser.
 *
 * This file used to create a Supabase client from VITE_SUPABASE_URL and
 * VITE_SUPABASE_ANON_KEY, both of which shipped inside the JavaScript bundle. That anon
 * key could read the entire `leads` table, so every customer's name, phone, email and
 * address was public to anyone who viewed source.
 *
 * The booking form now posts to /api/lead and the contact form to /api/contact, both of
 * which run on the server and hold the only credential.
 *
 * The old admin screens under src/pages_react/admin/ still import this. They are not
 * built into the site and are being replaced; importing this throws on purpose so that
 * anything still reaching for a browser-side database client fails loudly at the point
 * of use instead of quietly shipping a key.
 */
export const supabase: never = new Proxy({}, {
  get() {
    throw new Error(
      'src/lib/supabase.ts is retired. Use /api/lead, /api/contact, or a server route — ' +
      'the browser must not hold a database credential.',
    );
  },
}) as never;
