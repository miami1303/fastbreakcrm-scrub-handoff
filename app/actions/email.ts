"use server";

import { clickBase } from "@/lib/view-tracking";
import { type CustomerMessageKind, type EmailKind } from "@/lib/crm-constants";
import { messageLinks, newEmailToken } from "@/lib/customer-email-views";

import { createHash, randomBytes } from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { clientIp, getAccessibleEstimate, getStaff, jobLabel, notify, publicOrigin, userAgent } from "@/lib/crm-server";
import { docInput, loadLeadBundle, modeFor } from "@/lib/lead-data";
import { ESIGN_LINK_TEXT, carrierForEmail, formatMoney, repInfo } from "@/lib/quote-template";
import { sanitizeEmailHtml } from "@/lib/templates/free-text";
import { escapeHtml } from "@/lib/templates/layout";
import { renderTemplate, renderTemplateDef } from "@/lib/templates/registry";
import { esignKindFor, rowTemplate, sendKindFor } from "@/lib/templates/email-templates";
import { findActiveTemplate } from "@/lib/email-templates-server";
import { activeBlock, blockedMessage } from "@/lib/suppression";
import { mailMode, sendMail, sender } from "@/lib/mailer";
import { attemptAutoChargeForEstimate } from "@/lib/payments/auto-charge";
import { scrubSecrets } from "@/lib/payments/decide";
import { plainTextPart } from "@/lib/mail-parts";

type Admin = ReturnType<typeof createSupabaseAdminClient>;
/**
 * Real send when SMTP / Resend is configured (lib/mailer.ts); the result is logged as a
 * 'delivered' / 'delivery_failed' event on the (append-only) email record. Returns null when
 * sending is not configured, so the caller falls back to copy + mailto.
 */
async function deliver(admin: Admin, row: { id: string; estimate_id: string }, mail: Parameters<typeof sendMail>[0]) {
  const r = await sendMail(mail);
  if (!r) return null;
  await admin.from("crm_email_events").insert({
    email_id: row.id, estimate_id: row.estimate_id, event: r.ok ? "delivered" : "delivery_failed",
    detail: (r.ok ? `${r.mode} ${r.id}` : `${r.mode}: ${r.error}`).slice(0, 500),
  });
  if (!r.ok) console.error("[crm] email delivery failed:", r.error);
  return r;
}

/** Customer link: /d/<FB job number>/<unguessable token> (job number shown, token = security). */
const customerDocUrl = (origin: string, job: string | null | undefined, token: string) =>
  job ? `${origin}/d/${encodeURIComponent(job)}/${token}` : `${origin}/d/${token}`;

type R<T = object> = ({ ok: true } & T) | { ok: false; error: string; needsOverride?: boolean };

const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

/**
 * Email Center: creates the append-only email record (with its tracking/e-sign token) and
 * returns the formatted email for the rep's mail app. Sending counts as touching the lead.
 *   - e_quote: Auto Transport Order for Service, TOTAL ONLY, no e-sign link.
 *   - booked_esign: e-sign link, Customer Payment (deposit paid) + Balance Due. Sendable at ANY
 *     status (Owner, 2026-10-23): estimate / quoted / follow-up as well as booked.
 *   - cc_form: Credit Card Authorization Form, always with e-sign, card shown as last 4.
 * CC Form, and E-Sign on a booked job, are blocked until a Deposit payment is recorded (admins may
 * override). E-Sign on a job that isn't booked yet needs no payment (the deposit comes after signing).
 */
export async function prepareEmail(estimateId: string, kind: EmailKind, adminOverride = false): Promise<R<{ to: string; fromName: string; subject: string; html: string; text: string; url: string; sent: boolean; cc: string | null }>> {
  try {
    const staff = await getStaff();
    if (!staff) return { ok: false, error: "Your session expired. Please sign in again." };
    if (!(await getAccessibleEstimate(staff, estimateId))) return { ok: false, error: "Estimate not found." };
    const bundle = await loadLeadBundle(estimateId);
    if (!bundle) return { ok: false, error: "Estimate not found." };
    if (!["cc_form", "e_quote", "booked_esign", "carrier_confirm"].includes(kind)) return { ok: false, error: "Unknown email type." };
    if (!bundle.est.customer_email) return { ok: false, error: "Add the customer's email first." };
    const block = await activeBlock(bundle.est.customer_email);
    if (block) return { ok: false, error: blockedMessage(block) };
    const isCarrier = kind === "carrier_confirm";
    if (isCarrier && bundle.est.status !== "booked") return { ok: false, error: "Book the job first. The Carrier Confirmation is for booked jobs." };
    if (isCarrier && !bundle.carrierNotes.length) return { ok: false, error: "Add the carrier in Carrier Info (under Vehicles) first." };
    if (!isCarrier && !(Number(bundle.quote?.total_amount) > 0)) return { ok: false, error: "Enter the Deposit and COD and click Save Charges first." };
    const needsDeposit = kind === "cc_form" || (kind === "booked_esign" && bundle.est.status === "booked");
    if (needsDeposit && !(bundle.paidAmount > 0)) {
      if (!(adminOverride && staff.role === "admin")) {
        return {
          ok: false,
          needsOverride: staff.role === "admin",
          error: "Record the deposit payment (Payments, with Deposit checked) before sending. The customer would see Customer Payment $0.00.",
        };
      }
    }

    const origin = await publicOrigin();
    const token = randomBytes(24).toString("base64url");
    const url = customerDocUrl(origin, bundle.est.job_number, token);
    // Emails carry only the newest carrier note (the customer page can show all of them).
    const input = carrierForEmail(docInput(bundle, origin, modeFor(kind)));
    input.links = {
      jobNumberHref: url,
      esignHref: kind === "e_quote" || isCarrier ? null : `${url}#esign`,
      trackingPixelUrl: `${origin}/api/email/open/${token}`,
      clickBase: clickBase(origin, token),
      optOutHref: `${origin}/u/${token}`,
    };
    const isCc = kind === "cc_form";
    // Every email goes through the shared branded layout (lib/templates).
    const rendered = renderTemplate(kind, input);
    const { html, subject } = rendered;
    const baseText = rendered.text;
    const unsubscribeUrl = `${origin}/u/${token}`;
    const text = plainTextPart({
      text: baseText,
      link: { label: kind === "e_quote" || isCarrier ? `Job No. ${bundle.est.job_number || ""}` : isCc ? ESIGN_LINK_TEXT.cc : ESIGN_LINK_TEXT.quote, url },
      company: bundle.company, unsubscribeUrl,
    });

    const admin = createSupabaseAdminClient();
    const mode = mailMode();
    const repEmail = repInfo(input).email || null;
    const sent = sender(bundle.company, repEmail);
    const from = { name: sent.name, address: sent.address };
    const cc = mode && repEmail && repEmail.toLowerCase() !== bundle.est.customer_email.toLowerCase() ? repEmail : null;
    const { data: row, error } = await admin.from("crm_emails").insert({
      estimate_id: estimateId, token, kind, subject, sent_to: bundle.est.customer_email,
      sent_by: staff.userId, sent_by_name: staff.name, doc_sha256: sha256(html), html_snapshot: html,
      sent_from: mode ? from.address : repEmail, sent_cc: cc, reply_to: mode ? sent.replyTo : null, delivery: mode || "mailto",
    }).select("id, estimate_id").single();
    if (error || !row) throw new Error(error?.message || "Could not log the email.");
    await admin.from("estimates").update({ last_touched_at: new Date().toISOString() }).eq("id", estimateId);
    const d = await deliver(admin, row, { from, to: bundle.est.customer_email, cc, replyTo: sent.replyTo, subject, html, text, unsubscribeUrl });
    if (d && !d.ok) return { ok: false, error: `The email was logged but could not be sent (${d.error}). Check the email settings and try again.` };
    return { ok: true, to: bundle.est.customer_email, fromName: from.name, subject, html, text, url, sent: !!d, cc };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Could not prepare the email.";
    console.error("[crm] email:", message);
    return { ok: false, error: message };
  }
}

/** Customer e-signature. Saves name, email, agreement, time, IP, user agent and the signed document + hash. */
export async function signDocument(token: string, form: { agreed: boolean; email: string; name: string }): Promise<R<{ signedAt: string }>> {
  try {
    const name = String(form.name || "").trim().slice(0, 120);
    const email = String(form.email || "").trim().slice(0, 200);
    if (!form.agreed) return { ok: false, error: "Please check the box to agree to the terms." };
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return { ok: false, error: "Enter a valid email address." };
    if (name.length < 2) return { ok: false, error: "Enter your full name." };
    const admin = createSupabaseAdminClient();
    const { data: em } = await admin.from("crm_emails").select("*").eq("token", token).maybeSingle();
    if (!em || !["cc_form", "booked_esign"].includes(em.kind)) return { ok: false, error: "This link can't be signed." };
    const { data: already } = await admin.from("crm_email_events").select("id").eq("email_id", em.id).eq("event", "signed").limit(1);
    if (already?.length) return { ok: false, error: "This document was already signed." };
    const bundle = await loadLeadBundle(em.estimate_id);
    if (!bundle) return { ok: false, error: "This document is no longer available." };

    const signedAt = new Date().toISOString();
    const origin = await publicOrigin();
    const input = docInput(bundle, origin, modeFor(em.kind));
    input.signature = { name, signedAt };
    const isCc = em.kind === "cc_form";
    const signedHtml = renderTemplate(em.kind, input).html;
    const ip = await clientIp();
    const { error } = await admin.from("crm_email_events").insert({
      email_id: em.id, estimate_id: em.estimate_id, event: "signed", created_at: signedAt, ip, user_agent: await userAgent(),
      signer_name: name, signer_email: email, agreed: true, signed_html: signedHtml, signed_sha256: sha256(signedHtml),
    });
    if (error) throw new Error(error.message);
    // Owner + admins/supervisors + the ASSIGNED REP (their cue to call for payment), booked or not.
    const repUser = bundle.rep?.user_id || null;
    if (isCc) {
      await notify("cc_signed", `CC form E-sign received: ${jobLabel(bundle.est)}`, bundle.est, repUser);
    } else {
      await admin.from("quotes").update({ signed_at: signedAt }).eq("estimate_id", em.estimate_id);
      const total = formatMoney(bundle.quote?.total_amount);
      await notify("contract_signed", `Customer signed - ${total} job booked: ${jobLabel(bundle.est)}`, bundle.est, repUser, Number(bundle.quote?.total_amount) || null);
    }
    // Both e-signs = a signed contract (booked_esign) AND a signed credit card form (cc_form)
    // on the existing e-sign page. Auto-charge reads those. A failure here must not undo the signature.
    try {
      await attemptAutoChargeForEstimate(em.estimate_id);
    } catch (error) {
      console.error("[crm] auto-charge after e-sign:", error instanceof Error ? scrubSecrets(error.message) : "unknown");
    }
    return { ok: true, signedAt };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Could not save the signature.";
    console.error("[crm] e-sign:", message);
    return { ok: false, error: message };
  }
}

type FreeTextForm = { subject: string; bodyHtml: string; cc: boolean; includeQuoteLink: boolean };

async function freeTextParts(estimateId: string, f: FreeTextForm, token: string | null) {
  const bundle = await loadLeadBundle(estimateId);
  if (!bundle) return null;
  const origin = await publicOrigin();
  const url = customerDocUrl(origin, bundle.est.job_number, token || "preview");
  let body = sanitizeEmailHtml(f.bodyHtml);
  if (f.includeQuoteLink) {
    body += `<p style="margin:14px 0 0 0;"><a href="${escapeHtml(url)}" data-quote-link="1">View your quote (Job ${escapeHtml(bundle.est.job_number || "")})</a></p>`;
  }
  const input = docInput(bundle, origin, "e_quote");
  input.freeText = { subject: String(f.subject || "").trim().slice(0, 200), bodyHtml: body };
  input.links = token ? { trackingPixelUrl: `${origin}/api/email/open/${token}`, clickBase: clickBase(origin, token), optOutHref: `${origin}/u/${token}` } : { optOutHref: "#" };
  const rendered = renderTemplate("free_text", input);
  const rep = repInfo(input);
  return { bundle, rendered, url, from: rep.email, cc: f.cc ? (rep.email || bundle.company.companyEmail) : null };
}

/** Composer live preview (header + body + rep signature), nothing is logged. */
export async function previewFreeText(estimateId: string, f: FreeTextForm): Promise<R<{ html: string }>> {
  const staff = await getStaff();
  if (!staff) return { ok: false, error: "Your session expired. Please sign in again." };
  if (!(await getAccessibleEstimate(staff, estimateId))) return { ok: false, error: "Estimate not found." };
  const p = await freeTextParts(estimateId, f, null);
  return p ? { ok: true, html: p.rendered.html } : { ok: false, error: "Estimate not found." };
}

/**
 * FREE TEXT EMAIL: sanitized rep body in the shared branded layout. Logged as 'free_text' with the
 * exact HTML snapshot, tracked for opens, opt-out link, removal list respected, touches the lead.
 */
export async function sendFreeText(estimateId: string, f: FreeTextForm): Promise<R<{ to: string; cc: string | null; fromName: string; subject: string; html: string; text: string; url: string; sent: boolean }>> {
  try {
    const staff = await getStaff();
    if (!staff) return { ok: false, error: "Your session expired. Please sign in again." };
    if (!(await getAccessibleEstimate(staff, estimateId))) return { ok: false, error: "Estimate not found." };
    const subject = String(f.subject || "").trim();
    if (!subject) return { ok: false, error: "Type a subject." };
    if (!sanitizeEmailHtml(f.bodyHtml).replace(/<[^>]*>|&nbsp;/g, "").trim() && !/<img/i.test(f.bodyHtml)) return { ok: false, error: "Type a message." };
    const token = randomBytes(24).toString("base64url");
    const p = await freeTextParts(estimateId, f, token);
    if (!p) return { ok: false, error: "Estimate not found." };
    const to = p.bundle.est.customer_email;
    if (!to) return { ok: false, error: "Add the customer's email first." };
    const block = await activeBlock(to);
    if (block) return { ok: false, error: blockedMessage(block) };
    const admin = createSupabaseAdminClient();
    const { html } = p.rendered;
    const unsubscribeUrl = `${await publicOrigin()}/u/${token}`;
    const text = plainTextPart({ text: p.rendered.text, link: f.includeQuoteLink ? { label: `View your quote (Job ${p.bundle.est.job_number || ""})`, url: p.url } : null, company: p.bundle.company, unsubscribeUrl });
    const mode = mailMode();
    const sent = sender(p.bundle.company, p.from);
    const from = { name: sent.name, address: sent.address };
    const { data: row, error } = await admin.from("crm_emails").insert({
      estimate_id: estimateId, token, kind: "free_text", subject: p.rendered.subject, sent_to: to, sent_cc: p.cc,
      sent_from: mode ? from.address : p.from, reply_to: mode ? sent.replyTo : null, delivery: mode || "mailto",
      sent_by: staff.userId, sent_by_name: staff.name, doc_sha256: sha256(html), html_snapshot: html,
    }).select("id, estimate_id").single();
    if (error || !row) throw new Error(error?.message || "Could not log the email.");
    await admin.from("estimates").update({ last_touched_at: new Date().toISOString() }).eq("id", estimateId);
    const d = await deliver(admin, row, { from, to, cc: p.cc, replyTo: sent.replyTo, subject: p.rendered.subject, html, text, unsubscribeUrl });
    if (d && !d.ok) return { ok: false, error: `The email was logged but could not be sent (${d.error}). Check the email settings and try again.` };
    return { ok: true, to, cc: p.cc, fromName: from.name, subject: p.rendered.subject, html, text, url: p.url, sent: !!d };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Could not send the email.";
    console.error("[crm] free text:", message);
    return { ok: false, error: message };
  }
}

/**
 * One customer letter. The rep presses Send. A quote view never calls this.
 * Quote letters use the landing page and no tracking pixel. Other letters use the pixel.
 * Mail goes out only when SMTP or Resend is configured; otherwise the letter is logged
 * and the rep's own mail program opens. Do not call this from tests.
 */
export async function sendCustomerMessage(estimateId: string, templateKey: CustomerMessageKind | string): Promise<R<{ to: string; fromName: string; subject: string; html: string; text: string; url: string; sent: boolean; cc: string | null }>> {
  try {
    const staff = await getStaff();
    if (!staff) return { ok: false, error: "Your session expired. Please sign in again." };
    if (!(await getAccessibleEstimate(staff, estimateId))) return { ok: false, error: "Estimate not found." };
    // Maintenance > Email Center row (active), else the code seed with that key.
    const tpl = await findActiveTemplate(String(templateKey || ""));
    if (!tpl) return { ok: false, error: "That email template was removed or turned off. Reopen the Email Center." };
    const kind = sendKindFor(tpl);
    const bundle = await loadLeadBundle(estimateId);
    if (!bundle) return { ok: false, error: "Estimate not found." };
    if (!bundle.est.customer_email) return { ok: false, error: "Add the customer's email first." };
    const block = await activeBlock(bundle.est.customer_email);
    if (block) return { ok: false, error: blockedMessage(block) };

    const origin = await publicOrigin();
    const token = newEmailToken();
    const tracked = messageLinks(kind, origin, token, bundle.est.job_number);
    const input = docInput(bundle, origin, "e_quote");
    input.links = tracked.links;
    const admin = createSupabaseAdminClient();
    const mode = mailMode();
    // Maintenance > Email Center "E-sign" option: a separate signable document (booked_esign /
    // cc_form, same page, rules and notifications as the E-Sign / CC Form buttons) linked in red.
    const esignKind = esignKindFor(tpl.esign);
    let esignRow: { token: string; url: string } | null = null;
    if (esignKind) {
      if (!(Number(bundle.quote?.total_amount) > 0)) return { ok: false, error: "This template includes an e-sign link. Enter the Deposit and COD and click Save Charges first." };
      const needsDeposit = esignKind === "cc_form" || bundle.est.status === "booked";
      if (needsDeposit && !(bundle.paidAmount > 0)) return { ok: false, error: "This template includes an e-sign link. Record the deposit payment (Payments, with Deposit checked) first, or send the E-Sign / CC Form from the Email Center buttons (admins can override there)." };
      const esToken = randomBytes(24).toString("base64url");
      const esUrl = customerDocUrl(origin, bundle.est.job_number, esToken);
      const esInput = docInput(bundle, origin, modeFor(esignKind));
      esInput.links = { jobNumberHref: esUrl, esignHref: `${esUrl}#esign`, optOutHref: `${origin}/u/${esToken}` };
      const esHtml = renderTemplate(esignKind, esInput).html;
      const { error: esErr } = await admin.from("crm_emails").insert({
        estimate_id: estimateId, token: esToken, kind: esignKind, subject: `${tpl.name} (e-sign link)`, sent_to: bundle.est.customer_email,
        sent_by: staff.userId, sent_by_name: staff.name, doc_sha256: sha256(esHtml), html_snapshot: esHtml,
        sent_from: null, sent_cc: null, reply_to: null, delivery: mode || "mailto",
        ...(tpl.id.startsWith("seed:") ? {} : { template_id: tpl.id }),
      });
      if (esErr) throw new Error(esErr.message);
      esignRow = { token: esToken, url: `${esUrl}#esign` };
      input.links = { ...input.links, letterEsign: { href: esignRow.url, text: esignKind === "cc_form" ? ESIGN_LINK_TEXT.cc : ESIGN_LINK_TEXT.quote } };
    }
    const rendered = renderTemplateDef(rowTemplate(tpl), input);
    const unsubscribeUrl = `${origin}/u/${token}`;
    const text = plainTextPart({
      text: rendered.text,
      link: tracked.quote ? { label: `Click job number ${bundle.est.job_number || ""} to view your quote`, url: tracked.landing } : null,
      company: bundle.company,
      unsubscribeUrl,
    });
    const repEmail = repInfo(input).email || null;
    const sentFrom = sender(bundle.company, repEmail);
    const from = { name: sentFrom.name, address: sentFrom.address };
    const cc = mode && repEmail && repEmail.toLowerCase() !== bundle.est.customer_email.toLowerCase() ? repEmail : null;
    const { html, subject } = rendered;
    const { data: row, error } = await admin.from("crm_emails").insert({
      estimate_id: estimateId, token, kind, subject, sent_to: bundle.est.customer_email,
      sent_by: staff.userId, sent_by_name: staff.name, doc_sha256: sha256(html), html_snapshot: html,
      sent_from: mode ? from.address : repEmail, sent_cc: cc, reply_to: mode ? sentFrom.replyTo : null, delivery: mode || "mailto",
      ...(tpl.id.startsWith("seed:") ? {} : { template_id: tpl.id }),
    }).select("id, estimate_id").single();
    if (error || !row) {
      if ((error?.message || "").includes("crm_emails_kind_check")) {
        return { ok: false, error: "These customer messages need the new database migration before they can be sent." };
      }
      throw new Error(error?.message || "Could not log the email.");
    }
    await admin.from("estimates").update({ last_touched_at: new Date().toISOString() }).eq("id", estimateId);
    const d = await deliver(admin, row, { from, to: bundle.est.customer_email, cc, replyTo: sentFrom.replyTo, subject, html, text, unsubscribeUrl });
    if (d && !d.ok) return { ok: false, error: `The email was logged but could not be sent (${d.error}). Check the email settings and try again.` };
    return { ok: true, to: bundle.est.customer_email, fromName: from.name, subject, html, text, url: tracked.quote ? tracked.landing : tracked.documentUrl, sent: !!d, cc };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Could not prepare the email.";
    console.error("[crm] customer message:", message);
    return { ok: false, error: message };
  }
}

/**
 * Email Center preview (no send, no log, no token): the customer letter rendered with this
 * lead's CRM fields (customer, job no, vehicles, prices, rep), like the old CRM's preview.
 * Links point at a "preview" token that resolves to nothing.
 */
export async function previewCustomerMessage(estimateId: string, templateKey: CustomerMessageKind | string): Promise<R<{ html: string; subject: string }>> {
  try {
    const tpl = await findActiveTemplate(String(templateKey || ""));
    if (!tpl) return { ok: false, error: "That email template was removed or turned off." };
    const kind = sendKindFor(tpl);
    const staff = await getStaff();
    if (!staff) return { ok: false, error: "Your session expired. Please sign in again." };
    if (!(await getAccessibleEstimate(staff, estimateId))) return { ok: false, error: "Estimate not found." };
    const bundle = await loadLeadBundle(estimateId);
    if (!bundle) return { ok: false, error: "Estimate not found." };
    const origin = await publicOrigin();
    const tracked = messageLinks(kind, origin, "preview", bundle.est.job_number);
    const input = docInput(bundle, origin, "e_quote");
    const ek = esignKindFor(tpl.esign);
    input.links = { ...tracked.links, letterEsign: ek ? { href: customerDocUrl(origin, bundle.est.job_number, "preview") + "#esign", text: ek === "cc_form" ? ESIGN_LINK_TEXT.cc : ESIGN_LINK_TEXT.quote } : null };
    const { html, subject } = renderTemplateDef(rowTemplate(tpl), input);
    return { ok: true, html, subject };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not build the preview." };
  }
}

/** Read-only copy of an email exactly as sent (tracking pixel removed so viewing it in the CRM isn't an "open"). */
export async function emailSnapshot(estimateId: string, emailId: string): Promise<R<{ html: string; subject: string; seq: number | null }>> {
  const staff = await getStaff();
  if (!staff) return { ok: false, error: "Your session expired. Please sign in again." };
  if (!(await getAccessibleEstimate(staff, estimateId))) return { ok: false, error: "Estimate not found." };
  const admin = createSupabaseAdminClient();
  const { data } = await admin.from("crm_emails").select("html_snapshot, subject, seq").eq("id", emailId).eq("estimate_id", estimateId).maybeSingle();
  if (!data) return { ok: false, error: "Email not found." };
  if (!data.html_snapshot) return { ok: false, error: "This email was sent before snapshots were stored." };
  const html = String(data.html_snapshot).replace(/<img[^>]*\/api\/email\/open\/[^>]*>/g, "");
  return { ok: true, html, subject: data.subject, seq: data.seq };
}
