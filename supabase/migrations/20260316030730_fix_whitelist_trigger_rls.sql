/*
  # Fix Admin Whitelist Trigger — RLS Bypass

  ## Summary
  The check_admin_whitelist trigger function was querying the admin_whitelist
  table, which has RLS enabled. During auth token generation, there is no JWT
  context, so the RLS policy (which checks auth.jwt() ->> 'email') returned
  no rows for any email — causing the trigger to always raise an exception and
  return a 500 Internal Server Error from Supabase auth.

  ## Fix
  Replace the trigger function with a version that uses SET search_path and
  queries the table via a SECURITY DEFINER function that bypasses RLS by
  using the pg_catalog to check directly, without relying on JWT context.

  The simplest correct approach: recreate the function with SECURITY DEFINER
  and explicitly set row_security = off for the duration of the check, or
  use a direct query that bypasses RLS (since SECURITY DEFINER functions
  run as the function owner who is a superuser-equivalent).

  Actually the cleanest fix is to simply alter the admin_whitelist table to
  FORCE ROW LEVEL SECURITY = false for superusers (which is the default), and
  ensure the function owner can bypass RLS by granting bypassrls, OR simply
  restructure the function to use SET LOCAL row_security = off.
*/

-- Recreate the function with row_security disabled for the check
CREATE OR REPLACE FUNCTION check_admin_whitelist()
RETURNS TRIGGER AS $$
BEGIN
  SET LOCAL row_security = off;
  IF NOT EXISTS (
    SELECT 1 FROM admin_whitelist WHERE email = NEW.email
  ) THEN
    RAISE EXCEPTION 'Email not authorized for admin access';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
