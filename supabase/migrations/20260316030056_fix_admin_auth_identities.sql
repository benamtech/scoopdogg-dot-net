/*
  # Fix Admin Auth Identities

  ## Summary
  The two admin users (ben@palaskasconsulting.com and scoopdogg129@gmail.com) were
  created directly in auth.users with encrypted passwords, but no corresponding
  rows were inserted into auth.identities for the 'email' provider. Supabase
  requires an identity row to authenticate via email/password. This migration
  inserts those missing identity records so login works correctly.

  ## Changes
  - Inserts email identity rows into auth.identities for both admin users
*/

INSERT INTO auth.identities (id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
SELECT
  gen_random_uuid() AS id,
  u.email AS provider_id,
  u.id AS user_id,
  jsonb_build_object('sub', u.id::text, 'email', u.email) AS identity_data,
  'email' AS provider,
  NULL AS last_sign_in_at,
  u.created_at,
  u.created_at
FROM auth.users u
WHERE u.email IN ('ben@palaskasconsulting.com', 'scoopdogg129@gmail.com')
AND NOT EXISTS (
  SELECT 1 FROM auth.identities i WHERE i.user_id = u.id AND i.provider = 'email'
);
