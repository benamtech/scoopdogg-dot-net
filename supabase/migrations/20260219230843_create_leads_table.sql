/*
  # Create leads table

  ## Summary
  Creates the core `leads` table for storing all service request submissions from the public booking form.

  ## New Tables

  ### `leads`
  Stores every booking/inquiry submitted through the website.

  | Column | Type | Notes |
  |--------|------|-------|
  | id | uuid | Primary key, auto-generated |
  | name | text | Customer full name, required |
  | phone | text | Contact phone, required |
  | email | text | Contact email, required |
  | address | text | Street address |
  | city | text | Service city, required |
  | service_type | text | 'weekly', 'one-time', or 'turf' |
  | yard_size | text | 'small', 'medium', or 'large' |
  | num_dogs | int | Number of dogs |
  | frequency | text | 'weekly' or 'biweekly' |
  | notes | text | Gate codes, dog info, special instructions |
  | source_page | text | URL path the booking was submitted from |
  | status | text | Lead status — defaults to 'new'. Values: new, contacted, quoted, active, declined |
  | created_at | timestamptz | Auto-set on insert |
  | updated_at | timestamptz | Auto-updated on change |

  ## Security

  - RLS is enabled on the leads table
  - Public (anonymous) users can INSERT new leads (submit booking forms)
  - Only authenticated users can SELECT leads (admin reads)
  - Only authenticated users can UPDATE leads (admin edits status/notes)
  - No public DELETE allowed

  ## Notes
  - An `updated_at` trigger keeps the timestamp fresh automatically
  - Status defaults to 'new' so every fresh lead is immediately visible in the admin dashboard
*/

CREATE TABLE IF NOT EXISTS leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  phone text NOT NULL,
  email text NOT NULL,
  address text DEFAULT '',
  city text NOT NULL,
  service_type text DEFAULT '',
  yard_size text DEFAULT 'medium',
  num_dogs int DEFAULT 1,
  frequency text DEFAULT 'weekly',
  notes text DEFAULT '',
  source_page text DEFAULT '',
  status text DEFAULT 'new',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE leads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can submit a lead"
  ON leads
  FOR INSERT
  TO anon
  WITH CHECK (true);

CREATE POLICY "Authenticated users can view all leads"
  ON leads
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can update leads"
  ON leads
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER leads_updated_at
  BEFORE UPDATE ON leads
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();
