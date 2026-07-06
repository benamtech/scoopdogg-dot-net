import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const SERVICE_LABELS: Record<string, string> = {
  weekly: "Keep It Clean (Weekly)",
  turf: "Turf Rescue (Surface Deodorizing)",
  "one-time": "Turf Deep Clean (One-time)",
  "yard-deep-clean": "Yard Deep Clean",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const lead = await req.json();

    const serviceLabel = SERVICE_LABELS[lead.service_type] || lead.service_type;
    const dogsLabel = lead.num_dogs === 0 ? "N/A" : `${lead.num_dogs} dog${lead.num_dogs !== 1 ? "s" : ""}`;
    const submittedAt = new Date(lead.created_at || new Date()).toLocaleString("en-US", {
      timeZone: "America/Los_Angeles",
      dateStyle: "full",
      timeStyle: "short",
    });

    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f5f5f0; margin: 0; padding: 32px 16px; }
    .card { background: #fff; border-radius: 16px; max-width: 560px; margin: 0 auto; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,0.08); }
    .header { background: #1a3c2e; padding: 28px 32px; }
    .header h1 { color: #fff; font-size: 22px; margin: 0 0 4px; font-weight: 700; }
    .header p { color: rgba(255,255,255,0.65); font-size: 13px; margin: 0; }
    .badge { display: inline-block; background: #e8a020; color: #fff; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; padding: 3px 10px; border-radius: 20px; margin-top: 10px; }
    .body { padding: 28px 32px; }
    .section-title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #999; margin: 0 0 12px; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 24px; }
    .field { background: #f9f8f5; border-radius: 10px; padding: 12px 14px; }
    .field .label { font-size: 11px; color: #999; font-weight: 600; text-transform: uppercase; letter-spacing: 0.6px; margin-bottom: 4px; }
    .field .value { font-size: 15px; color: #1a1a1a; font-weight: 500; }
    .full { grid-column: 1 / -1; }
    .notes-box { background: #f9f8f5; border-radius: 10px; padding: 14px; margin-bottom: 24px; color: #444; font-size: 14px; line-height: 1.6; }
    .cta { background: #1a3c2e; border-radius: 12px; padding: 16px 20px; display: flex; align-items: center; justify-content: space-between; }
    .cta a { color: #fff; font-size: 13px; font-weight: 600; text-decoration: none; }
    .footer { text-align: center; padding: 16px; color: #bbb; font-size: 11px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <h1>New Lead Received</h1>
      <p>${submittedAt}</p>
      <div class="badge">New</div>
    </div>
    <div class="body">
      <p class="section-title">Contact Info</p>
      <div class="grid">
        <div class="field">
          <div class="label">Name</div>
          <div class="value">${lead.name || "—"}</div>
        </div>
        <div class="field">
          <div class="label">Phone</div>
          <div class="value">${lead.phone || "—"}</div>
        </div>
        <div class="field full">
          <div class="label">Email</div>
          <div class="value">${lead.email || "—"}</div>
        </div>
        <div class="field full">
          <div class="label">Address</div>
          <div class="value">${lead.address ? `${lead.address}, ${lead.city}` : lead.city || "—"}</div>
        </div>
      </div>

      <p class="section-title">Service Details</p>
      <div class="grid">
        <div class="field full">
          <div class="label">Service</div>
          <div class="value">${serviceLabel}</div>
        </div>
        <div class="field">
          <div class="label">Dogs</div>
          <div class="value">${dogsLabel}</div>
        </div>
        <div class="field">
          <div class="label">Yard Size</div>
          <div class="value">${lead.yard_size ? lead.yard_size.charAt(0).toUpperCase() + lead.yard_size.slice(1) : "—"}</div>
        </div>
        <div class="field">
          <div class="label">Source</div>
          <div class="value">${lead.source_page || "—"}</div>
        </div>
      </div>

      ${lead.notes ? `
      <p class="section-title">Notes</p>
      <div class="notes-box">${lead.notes}</div>
      ` : ""}

      <div class="cta">
        <a href="https://scoopdogg.net/admin">View in Admin Dashboard →</a>
      </div>
    </div>
    <div class="footer">Scoop Dogg &bull; mail.amtechleads.com</div>
  </div>
</body>
</html>
    `.trim();

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${Deno.env.get("RESEND_API_KEY")}`,
      },
      body: JSON.stringify({
        from: "Scoop Dogg Leads <leads@mail.amtechleads.com>",
        to: ["josue@scoopdogg.net", "scoopdogg129@gmail.com", "ben@amtechai.com"],
        subject: `New Lead: ${lead.name} — ${serviceLabel}`,
        html,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      return new Response(JSON.stringify({ error: err }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
