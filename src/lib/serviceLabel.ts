/**
 * What a lead's `service_slug` is called on an admin screen.
 *
 * Declared once for the browser. Three admin screens each carried their own copy and
 * every copy read `lead.service_type` — a field the API does not return — so the Service
 * column was an em-dash on every row of every screen and sorting by it did nothing. The
 * column is `leads.service_slug`.
 *
 * The wording is deliberately the same as `SERVICE_LABELS` in `api/lead.ts`, which is
 * what Josue reads in the lead notification email. Those two must not drift; they are
 * still two declarations because `api/` is bundled separately from the browser code and
 * joining them would put the lead-capture path at risk for a naming tidy-up.
 *
 * The slugs below are the ten the write path accepts; seven of them are in the table
 * today, counted rather than guessed.
 */
export const SERVICE_LABELS: Record<string, string> = {
  'weekly': 'Keep It Clean (Weekly)',
  'turf': 'Turf Rescue (Surface Deodorizing)',
  'one-time': 'Turf Deep Clean (One-time)',
  'yard-deep-clean': 'Yard Deep Clean',
  'kitty-litter': 'Kitty Litter Exchange',
  'dog-run': 'Dog Run Cleanup',
  'cat-tree': 'Cat Tree Cleaning',
  'pressure-washing': 'Pressure Washing',
  'litter-robot': 'Litter-Robot Cleaning',
  'yard-maintenance': 'Yard Maintenance',
};

/** An unknown slug shows itself rather than an em-dash: seeing it is how we learn it. */
export function serviceLabel(slug: string | null | undefined) {
  if (!slug) return '—';
  return SERVICE_LABELS[slug] || slug;
}
