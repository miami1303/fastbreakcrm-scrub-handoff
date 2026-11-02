// Tracked link click: /api/email/click/<token>?u=<url>. Records a 'viewed' (click) event, the
// strongest signal, then redirects. Quotes -> "Quote Viewed", other emails -> "Email Viewed"
// (banner + Recurring). Only redirects to a URL that is actually in that email (no open redirect).
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { jobLabel, notify } from "@/lib/crm-server";
import { emailKindLabel } from "@/lib/crm-constants";
import { LINK_DETAIL, eventLabel, isPrefetchUA, notifyKindFor } from "@/lib/view-tracking";
import { trackedHref } from "@/lib/templates/tracking";
import { escapeHtml } from "@/lib/templates/layout";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const reqUrl = new URL(request.url);
  const target = reqUrl.searchParams.get("u") || "";
  let dest = "/";
  try {
    const admin = createSupabaseAdminClient();
    const { data: email } = await admin.from("crm_emails").select("id, estimate_id, kind, subject, html_snapshot").eq("token", token).maybeSingle();
    const base = `${reqUrl.origin}/api/email/click/${token}`;
    const inEmail = !!email && /^https?:\/\//i.test(target) && (email.html_snapshot || "").includes(escapeHtml(trackedHref(base, target)).replace(/^https?:\/\/[^/]+/, ""));
    if (email && inEmail) {
      dest = target;
      const ua = request.headers.get("user-agent") || "";
      if (!isPrefetchUA(ua)) {
        const { data: prior } = await admin.from("crm_email_events").select("id").eq("email_id", email.id).eq("event", "viewed").limit(1);
        const row = {
          email_id: email.id, estimate_id: email.estimate_id, event: "viewed",
          ip: (request.headers.get("x-forwarded-for") || "").split(",")[0].trim() || null, user_agent: ua.slice(0, 400),
        };
        const { error } = await admin.from("crm_email_events").insert({ ...row, detail: `${LINK_DETAIL}${target.slice(0, 500)}` });
        if (error) await admin.from("crm_email_events").insert(row); // before the 'detail' column exists
        if (!prior?.length) {
          const { data: est } = await admin.from("estimates").select("id, owner_id, job_number, customer_name").eq("id", email.estimate_id).maybeSingle();
          const label = eventLabel(email.kind, "viewed", LINK_DETAIL);
          if (est) await notify(label === "Quote Viewed" ? "quote_viewed" : notifyKindFor(email.kind), `${label} (clicked): ${emailKindLabel(email.kind)} "${email.subject || ""}" — ${jobLabel(est)}`, est);
        }
      }
    }
  } catch {
    // Tracking must never break the link.
  }
  return Response.redirect(new URL(dest, reqUrl.origin).toString(), 302);
}
