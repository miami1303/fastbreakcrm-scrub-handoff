import "server-only";
import { cookies } from "next/headers";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { clientIp, jobLabel, notify, publicOrigin, userAgent } from "@/lib/crm-server";
import { docInput, loadLeadBundle, modeFor } from "@/lib/lead-data";
import { renderTemplate } from "@/lib/templates/registry";
import { emailKindLabel, isCustomerMessageKind, isQuoteMessageKind, type EmailKind } from "@/lib/crm-constants";
import { QUOTE_OPEN_COOKIE } from "@/lib/customer-email-views";
import { eventLabel, isPrefetchUA } from "@/lib/view-tracking";

/** Customer page data for /d/<token>. Records a 'viewed' event (Quote Viewed banner on first view). */
export async function loadCustomerDocument(token: string, expectedJob?: string) {
  const admin = createSupabaseAdminClient();
  const { data: email } = await admin.from("crm_emails").select("*").eq("token", token).maybeSingle();
  if (!email) return null;
  const bundle = await loadLeadBundle(email.estimate_id);
  if (!bundle) return null;
  // /d/<job>/<token>: the job number in the link must be this token's job.
  if (expectedJob !== undefined && String(expectedJob).trim().toUpperCase() !== String(bundle.est.job_number || "").toUpperCase()) return null;
  const { data: events } = await admin.from("crm_email_events").select("event, created_at, signer_name, signed_html").eq("email_id", email.id).order("created_at");
  const signed = (events || []).find(e => e.event === "signed") || null;
  const firstView = !(events || []).some(e => e.event === "viewed");
  // A click on the tracked link (strongest signal). Link scanners that announce themselves are
  // shown the page but not counted. Quotes -> "Quote Viewed", other emails -> "Email Viewed".
  const ua = await userAgent();
  // The quote landing button already recorded this view and set a short cookie.
  // A query string is not enough to skip: only that cookie, matching this token.
  let openedFromButton = false;
  try {
    const jar = await cookies();
    openedFromButton = jar.get(QUOTE_OPEN_COOKIE)?.value === token;
  } catch { openedFromButton = false; }
  if (!isPrefetchUA(ua) && !openedFromButton) {
    await admin.from("crm_email_events").insert({ email_id: email.id, estimate_id: email.estimate_id, event: "viewed", ip: await clientIp(), user_agent: ua });
    if (firstView) {
      const label = eventLabel(email.kind, "viewed");
      await notify(label === "Quote Viewed" ? "quote_viewed" : "email_viewed", `${label} (clicked): ${emailKindLabel(email.kind)} "${email.subject || ""}" — ${jobLabel(bundle.est)}`, bundle.est);
    }
  }
  const origin = await publicOrigin();
  // A Free Text email's "View your quote" link, and a quote letter's landing button,
  // show the E-Quote (no e-sign).
  // Every customer letter (Pickup confirmed, Booked...) opens the customer order with the Carrier Info box (no e-sign).
  const docKind = email.kind === "free_text" || isQuoteMessageKind(email.kind) || isCustomerMessageKind(email.kind) ? "e_quote" : email.kind;
  // Carrier Confirmation opens the booked job order (with the Carrier Info box), never an e-sign.
  const renderKind = docKind === "carrier_confirm" ? "e_quote" : docKind;
  const input = docInput(bundle, origin, modeFor(docKind));
  input.links = { esignHref: docKind === "e_quote" ? null : "#esign", optOutHref: `/u/${token}` };
  return {
    kind: docKind as EmailKind,
    jobNumber: bundle.est.job_number,
    customerEmail: bundle.est.customer_email,
    customerName: bundle.est.customer_name,
    signedAt: signed?.created_at || null,
    signedHtml: signed?.signed_html || null,
    bodyHtml: renderTemplate(renderKind, input).bodyHtml,
  };
}

