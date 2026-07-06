/*
  # Create Admin Whitelist

  ## Summary
  Creates a whitelist of allowed admin email addresses and a database trigger
  that prevents any non-whitelisted email from signing up or being created
  in auth.users.

  ## New Tables
  - `admin_whitelist`
    - `email` (text, primary key) — the whitelisted email address

  ## Security
  - RLS enabled on admin_whitelist
  - Only authenticated whitelisted users can read the whitelist
  - A trigger on auth.users blocks inserts for non-whitelisted emails

  ## Notes
  1. Only ben@palaskasconsulting.com and scoopdogg129@gmail.com are allowed
  2. Any signup attempt from a non-whitelisted email is rejected at DB level
*/

CREATE TABLE IF NOT EXISTS admin_whitelist (
  email text PRIMARY KEY
);

ALTER TABLE admin_whitelist ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Whitelisted users can read whitelist"
  ON admin_whitelist FOR SELECT
  TO authenticated
  USING (auth.jwt() ->> 'email' = email);

INSERT INTO admin_whitelist (email) VALUES
  ('ben@palaskasconsulting.com'),
  ('scoopdogg129@gmail.com')
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION check_admin_whitelist()
RETURNS TRIGGER AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM admin_whitelist WHERE email = NEW.email
  ) THEN
    RAISE EXCEPTION 'Email not authorized for admin access';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS enforce_admin_whitelist ON auth.users;
CREATE TRIGGER enforce_admin_whitelist
  BEFORE INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION check_admin_whitelist();
