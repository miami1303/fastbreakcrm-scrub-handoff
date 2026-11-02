import "server-only";
// The one "ATTN Ops carrier owes" email to OPS_ALERT_EMAIL. Outbound from the CRM
// (not inbox watch), so Ops's crystal-company filter never applies. Callers gate it with
// estimates.carrier_owes_notified_at so a delivery is emailed once.
import type { SupabaseClient } from "@supabase/supabase-js";
import { getCompanyInfo } from "@/lib/company-settings";
import { sendMail, sender } from "@/lib/mailer";
import { crmStamp, cityState } from "@/lib/crm-time";
import { carrierOwesEmail, carrierPaidEmail } from "@/lib/carrier-owes";
import { needsCarrierEmail, pickupWindowEnd } from "@/lib/needs-carrier";
import { jobLabel, notify, publicOrigin } from "@/lib/crm-server";
import { chargebackEmail, chargebackOpen, buildEvidencePdf, type EvidenceStamp } from "@/lib/chargeback";

export const CARRIER_OWES_EMAIL_TO = process.env.OPS_ALERT_EMAIL || "ops@fastbreakcrm.test";

type Est = Record<string, unknown> & { id: string };

async function mailOps(company: Awaited<ReturnType<typeof getCompanyInfo>>, mail: { subject: string; text: string; html?: string; attachments?: { filename: string; content: Buffer; contentType?: string }[] }) {
  const from = sender(company);
  return sendMail({
    from: { name: from.name, address: from.address }, to: CARRIER_OWES_EMAIL_TO, replyTo: from.replyTo,
    subject: mail.subject, text: mail.text,
    html: mail.html || `<pre style="font:14px/1.5 sans-serif;white-space:pre-wrap">${mail.text.replace(/[&<>]/g, c => ({ "&": "&", "<": "<", ">": ">" })[c]!)}</pre>`,
    attachments: mail.attachments,
  });
}

/**
 * Carrier paid (Owner 2026-10-31): one "Carrier paid" banner for every admin/supervisor (+ lead owner)
 * and one "ATTN Ops carrier paid" email, once per payment event. Claimed with
 * estimates.carrier_paid_notified_at (reset when the paid entry is undone / a new debt is set).
 * If that column's migration is not applied yet, falls back to "no carrier_paid row since paid_at".
 */
export async function alertCarrierPaid(admin: SupabaseClient, est: Est, amount: string, amountNum: number, method: string): Promise<{ alerted: boolean; emailed: boolean }> {
  const now = new Date().toISOString();
  const { data: claimed, error } = await admin.from("estimates").update({ carrier_paid_notified_at: now }).eq("id", est.id).is("carrier_paid_notified_at", null).select("id");
  if (error) {
    const since = String(est.carrier_owes_paid_at || now);
    const { data: prior } = await admin.from("crm_notifications").select("id").eq("estimate_id", est.id).eq("kind", "carrier_paid").gte("created_at", since).limit(1);
    if (prior?.length) return { alerted: false, emailed: false };
  } else if (!claimed?.length) return { alerted: false, emailed: false };
  await notify("carrier_paid", `Carrier paid ${amount} — ${jobLabel(est as { job_number?: string; customer_name?: string })}`, est as { id: string; owner_id: string | null }, null, amountNum);
  try {
    const [{ data: notes }, { data: vehicles }, company, origin] = await Promise.all([
      admin.from("estimate_notes").select("body").eq("estimate_id", est.id).eq("kind", "carrier").order("created_at", { ascending: false }).limit(1),
      admin.from("vehicles").select("year, make, model").eq("estimate_id", est.id),
      getCompanyInfo(),
      publicOrigin(),
    ]);
    const mail = carrierPaidEmail({
      job: String(est.job_number || ""), customer: String(est.customer_name || ""), amount, method,
      paidAt: crmStamp(String(est.carrier_owes_paid_at || now)), carrier: String(notes?.[0]?.body || ""), url: `${origin}/estimates/${est.id}/payments`,
      vehicles: (vehicles || []).map(v => [v.year, v.make, v.model].filter(Boolean).join(" ")).filter(Boolean).join(", "),
    });
    const r = await mailOps(company, mail);
    if (!r?.ok) console.error("[crm] carrier paid email not sent:", r && !r.ok ? r.error : "mail not configured");
    return { alerted: true, emailed: !!r?.ok };
  } catch (e) {
    console.error("[crm] carrier paid email failed:", e instanceof Error ? e.message : "unknown");
    return { alerted: true, emailed: false };
  }
}

export async function sendCarrierOwesEmail(admin: SupabaseClient, est: Est, amount: string): Promise<boolean> {
  try {
    const [{ data: notes }, { data: vehicles }, company, origin] = await Promise.all([
      admin.from("estimate_notes").select("body").eq("estimate_id", est.id).eq("kind", "carrier").order("created_at", { ascending: false }).limit(1),
      admin.from("vehicles").select("year, make, model").eq("estimate_id", est.id),
      getCompanyInfo(),
      publicOrigin(),
    ]);
    const mail = carrierOwesEmail({
      job: String(est.job_number || ""), customer: String(est.customer_name || ""), amount,
      pickup: cityState(est.pickup_address as string) || String(est.pickup_address || ""),
      delivery: cityState(est.delivery_address as string) || String(est.delivery_address || ""),
      deliveredAt: crmStamp(est.delivered_at as string), carrier: String(notes?.[0]?.body || ""), url: `${origin}/estimates/${est.id}/payments`,
      vehicles: (vehicles || []).map(v => [v.year, v.make, v.model].filter(Boolean).join(" ")).filter(Boolean).join(", "),
    });
    const r = await mailOps(company, mail);
    if (!r?.ok) console.error("[crm] carrier owes email not sent:", r && !r.ok ? r.error : "mail not configured");
    return !!r?.ok;
  } catch (e) {
    console.error("[crm] carrier owes email failed:", e instanceof Error ? e.message : "unknown");
    return false;
  }
}

/** Needs carrier email (once per pickup window; caller claims estimates.needs_carrier_window first). Never throws. */
export async function sendNeedsCarrierEmail(est: Est): Promise<boolean> {
  try {
    const [company, origin] = await Promise.all([getCompanyInfo(), publicOrigin()]);
    const mail = needsCarrierEmail({
      job: String(est.job_number || ""), customer: String(est.customer_name || ""),
      windowEnd: pickupWindowEnd(est as Parameters<typeof pickupWindowEnd>[0]), url: `${origin}/estimates/${est.id}`,
    });
    const r = await mailOps(company, mail);
    if (!r?.ok) console.error("[crm] needs carrier email not sent:", r && !r.ok ? r.error : "mail not configured");
    return !!r?.ok;
  } catch (e) {
    console.error("[crm] needs carrier email failed:", e instanceof Error ? e.message : "unknown");
    return false;
  }
}

/**
 * Chargeback opened (Owner 2026-10-31): one "Chargeback" banner + one "ATTN Ops chargeback" email to
 *  per dispute. Claimed with estimates.chargeback_notified_at (reset per new dispute id).
 * Attaches a self-contained PDF evidence packet with real CRM e-sign and carrier-click stamps.
 */
export async function alertChargeback(admin: SupabaseClient, estimateId: string, d: { disputeId: string; status: string; reason: string; amountCents: number }): Promise<{ emailed: boolean }> {
  if (!chargebackOpen(d.status)) return { emailed: false };
  const { data: est } = await admin.from("estimates").select("*").eq("id", estimateId).maybeSingle();
  if (!est) return { emailed: false };
  const now = new Date().toISOString();
  const { data: claimed } = await admin.from("estimates").update({ chargeback_notified_at: now }).eq("id", estimateId)
    .or(`chargeback_notified_at.is.null,chargeback_notified_at.lt.${String(est.chargeback_at || now)}`).select("id");
  if (!claimed?.length) return { emailed: false };
  const amount = (d.amountCents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
  await notify("chargeback", `Chargeback ${amount} — ${jobLabel(est as { job_number?: string; customer_name?: string })}`, est as { id: string; owner_id: string | null }, null, d.amountCents / 100);
  try {
    const [company, origin, { data: emails }, { data: events }] = await Promise.all([
      getCompanyInfo(),
      publicOrigin(),
      admin.from("crm_emails").select("id, kind").eq("estimate_id", estimateId),
      admin.from("crm_email_events").select("email_id, event, created_at, signer_name, signed_html, ip, detail").eq("estimate_id", estimateId).in("event", ["signed", "viewed"]),
    ]);
    const byKind = (kind: string) => (emails || []).find(e => e.kind === kind);
    const signedFor = (emailId: string | undefined): EvidenceStamp | null => {
      if (!emailId) return null;
      const ev = (events || []).find(e => e.email_id === emailId && e.event === "signed");
      if (!ev) return null;
      return {
        label: "CRM e-sign stamp",
        signedAt: crmStamp(ev.created_at),
        signerName: ev.signer_name,
        ip: ev.ip,
        html: ev.signed_html,
      };
    };
    const carrierEv = (events || []).find(e => e.detail === "carrier_button" || (e.event === "viewed" && e.detail?.includes("carrier")));
    const carrierClick: EvidenceStamp | null = carrierEv ? {
      label: "Carrier info landing page click",
      signedAt: crmStamp(carrierEv.created_at),
      ip: carrierEv.ip,
    } : null;

    const contractEmail = byKind("booked_esign") || byKind("e_quote");
    const ccEmail = byKind("cc_form");
    const pdfBytes = await buildEvidencePdf({
      job: String(est.job_number || ""),
      customer: String(est.customer_name || ""),
      amount,
      reason: d.reason,
      disputeId: d.disputeId,
      openedAt: crmStamp(String(est.chargeback_at || now)),
      contract: signedFor(contractEmail?.id),
      ccAuth: signedFor(ccEmail?.id),
      carrierClick,
    });

    const mail = chargebackEmail({
      job: String(est.job_number || ""), customer: String(est.customer_name || ""), amount, reason: d.reason, status: d.status,
      openedAt: crmStamp(String(est.chargeback_at || now)), disputeId: d.disputeId, url: `${origin}/estimates/${estimateId}/payments`,
    });
    const r = await mailOps(company, {
      ...mail,
      attachments: [{ filename: `dispute-evidence-job-${est.job_number || "unknown"}.pdf`, content: Buffer.from(pdfBytes), contentType: "application/pdf" }],
    });
    if (!r?.ok) console.error("[crm] chargeback email not sent:", r && !r.ok ? r.error : "mail not configured");
    return { emailed: !!r?.ok };
  } catch (e) {
    console.error("[crm] chargeback email failed:", e instanceof Error ? e.message : "unknown");
    return { emailed: false };
  }
}
