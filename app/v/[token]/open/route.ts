// The landing button. A POST is a real click (page load does not come here).
// For quote letters records Quote viewed; for pickup confirmed records Email viewed
// (banner + recurring with time/date/IP), then opens the customer's document.
// Sets a short cookie so the document page does not record the same click a second time.
import { NextResponse } from "next/server";
import { emailKindLabel, isQuoteMessageKind } from "@/lib/crm-constants";
import { jobLabel, notify, publicOrigin } from "@/lib/crm-server";
import { QUOTE_BUTTON_DETAIL } from "@/lib/view-tracking";
import { buildViewRow, decideEmailView, isEmailToken, isPickupConfirm, QUOTE_OPEN_COOKIE, QUOTE_OPEN_MAX_AGE } from "@/lib/customer-email-views";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function plain(status: number, message: string) {
  return new Response(message, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
}

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!isEmailToken(token)) return plain(404, "This link is not valid.");
  try {
    const admin = createSupabaseAdminClient();
    const { data: email } = await admin.from("crm_emails").select("id, estimate_id, kind, subject, created_at").eq("token", token).maybeSingle();
    if (!email) return plain(404, "This link is not valid.");
    const { data: est } = await admin.from("estimates").select("id, owner_id, job_number, customer_name").eq("id", email.estimate_id).maybeSingle();
    if (!est) return plain(404, "This link is not valid.");
    const origin = await publicOrigin();
    const job = String(est.job_number || "");
    const dest = job ? `${origin}/d/${encodeURIComponent(job)}/${token}` : `${origin}/d/${token}`;
    const ua = request.headers.get("user-agent") || "";
    const decision = decideEmailView({ token, sentAt: email.created_at, at: Date.now(), ua, source: "button" });
    const isQuote = isQuoteMessageKind(email.kind);
    const isPickup = isPickupConfirm(email.kind);
    const count = decision.record && (isQuote || isPickup);
    let recorded = false;
    if (count) {
      const eventType = isPickup ? "email_viewed" : "quote_viewed";
      const notifyKind = isPickup ? "email_viewed" : "quote_viewed";
      const detail = isPickup ? "carrier_button" : QUOTE_BUTTON_DETAIL;
      try {
        await admin.from("customer_email_view_events").insert(buildViewRow({
          emailId: email.id, token, estimateId: email.estimate_id, eventType, userAgent: ua,
        }));
        const { data: prior } = await admin.from("crm_email_events").select("id").eq("email_id", email.id).eq("event", "viewed").limit(1);
        const row = {
          email_id: email.id, estimate_id: email.estimate_id, event: "viewed",
          ip: (request.headers.get("x-forwarded-for") || "").split(",")[0].trim() || null,
          user_agent: ua.slice(0, 400),
        };
        const first = await admin.from("crm_email_events").insert({ ...row, detail });
        const saved = first.error ? await admin.from("crm_email_events").insert(row) : first;
        recorded = !saved.error;
        if (recorded && !prior?.length) {
          const label = isPickup ? "Email Viewed (carrier info)" : "Quote Viewed (clicked)";
          await notify(notifyKind, `${label}: ${emailKindLabel(email.kind)} "${email.subject || ""}" — ${jobLabel(est)}`, est);
        }
      } catch {
        recorded = false;
      }
    }
    const res = NextResponse.redirect(dest, 303);
    if (recorded) {
      res.cookies.set(QUOTE_OPEN_COOKIE, token, {
        httpOnly: true, maxAge: QUOTE_OPEN_MAX_AGE, path: "/", sameSite: "lax", secure: origin.startsWith("https://"),
      });
    }
    return res;
  } catch {
    return plain(404, "This link is not valid.");
  }
}
