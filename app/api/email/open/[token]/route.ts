// Email open-tracking pixel. Quotes -> "Quote Viewed", other emails -> "Email Viewed" (banner +
// Recurring). Opens within 60 s of the send or from known prefetchers are ignored. Always a 1x1 GIF.
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { jobLabel, notify } from "@/lib/crm-server";
import { emailKindLabel } from "@/lib/crm-constants";
import { buildViewRow, decideEmailView } from "@/lib/customer-email-views";
import { eventLabel, ignoreOpen, notifyKindFor } from "@/lib/view-tracking";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GIF = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  try {
    const admin = createSupabaseAdminClient();
    const { data: email } = await admin.from("crm_emails").select("id, estimate_id, kind, subject, created_at").eq("token", token).maybeSingle();
    const ua = request.headers.get("user-agent") || "";
    if (email && !ignoreOpen(email.created_at, Date.now(), ua)) {
      const { data: prior } = await admin.from("crm_email_events").select("id").eq("email_id", email.id).eq("event", "opened").limit(1);
      await admin.from("crm_email_events").insert({
        email_id: email.id, estimate_id: email.estimate_id, event: "opened",
        ip: (request.headers.get("x-forwarded-for") || "").split(",")[0].trim() || null,
        user_agent: ua.slice(0, 400),
      });
      if (!prior?.length) {
        const { data: est } = await admin.from("estimates").select("id, owner_id, job_number, customer_name").eq("id", email.estimate_id).maybeSingle();
        if (est) await notify(notifyKindFor(email.kind), `${eventLabel(email.kind, "opened")} (opened): ${emailKindLabel(email.kind)} "${email.subject || ""}" — ${jobLabel(est)}`, est);
      }
    }
    // Separate, shorter clock for the new table only. Runs even when the 60-second
    // rule above ignored the hit. A missing table must not break the pixel.
    if (email) {
      const decision = decideEmailView({ token, sentAt: email.created_at, at: Date.now(), ua, source: "pixel" });
      if (decision.record && decision.event_type === "email_viewed") {
        await admin.from("customer_email_view_events").insert(buildViewRow({
          emailId: email.id, token, estimateId: email.estimate_id, eventType: "email_viewed", userAgent: ua,
        }));
      }
    }
  } catch {
    // Tracking must never break the email.
  }
  return new Response(GIF, { headers: { "content-type": "image/gif", "cache-control": "no-store, max-age=0" } });
}
