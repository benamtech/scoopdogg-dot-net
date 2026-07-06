/*
  # Create contact_messages table

  ## Summary
  Creates a table to store messages submitted via the public Contact page.

  ## New Tables
  - `contact_messages`
    - `id` (uuid, primary key, auto-generated)
    - `name` (text, required) — sender's name
    - `email` (text, required) — sender's email
    - `phone` (text, optional) — sender's phone
    - `subject` (text) — dropdown subject selection
    - `message` (text, required) — message body
    - `status` (text, default 'unread') — values: unread / read / replied
    - `created_at` (timestamptz, auto) — submission timestamp

  ## Security
  - RLS enabled
  - Public (anon) can INSERT only — allows contact form submissions without auth
  - Authenticated users can SELECT and UPDATE — for admin use
*/

CREATE TABLE IF NOT EXISTS contact_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text NOT NULL,
  phone text DEFAULT '',
  subject text DEFAULT '',
  message text NOT NULL,
  status text DEFAULT 'unread',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE contact_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can submit a contact message"
  ON contact_messages
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can view contact messages"
  ON contact_messages
  FOR SELECT
  TO authenticated
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can update contact messages"
  ON contact_messages
  FOR UPDATE
  TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);
