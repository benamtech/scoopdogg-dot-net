/*
  # Create Keepalive Table

  ## Purpose
  Prevents the Supabase free-tier database from being paused due to inactivity.

  ## Details
  - Creates a standalone `_keepalive` table with no foreign keys or relation to any other table
  - An external cron service (cron-job.org) pings a Supabase Edge Function every 4 days
  - The Edge Function inserts one row into this table then immediately deletes it
  - This write activity keeps the database active and prevents the 7-day inactivity pause

  ## Tables
  - `_keepalive`
    - `id` (uuid, primary key)
    - `created_at` (timestamptz, default now())

  ## Security
  - No RLS needed: this table is only ever written to by the service role key inside an Edge Function
  - The table will always be empty between pings
*/

CREATE TABLE IF NOT EXISTS _keepalive (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz DEFAULT now()
);

COMMENT ON TABLE _keepalive IS 'Keepalive table — written and immediately cleared by the keepalive Edge Function every 4 days to prevent Supabase free-tier inactivity pause.';
