import { notify, jobLabel } from "@/lib/crm-server";
import { getCompanyInfo } from "@/lib/company-settings";
import { LOGO_PATH } from "@/lib/brand";
import { sendMail, sender } from "@/lib/mailer";
import { WEB_LEAD_SOURCE } from "@/lib/lead-sources";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { geoForZip, milesForZips } from "@/lib/mileage-server";
import { composeAddress, lookupZip } from "@/lib/zip-lookup";
import { consumeMemoryRate, intakeSourceKey, isOverIntakeRate, INTAKE_RATE_WINDOW_MS } from "@/lib/intake-rate-limit";
import {
  CRM_PHONE_DISPLAY,
  INTAKE_NOTICE_TO,
  buildIntakeNotice,
  clientIpFromHeaders,
  escapeHtml,
  intakeNoticeHtml,
  isAllowedIntakeOrigin,
  noticeErrorFromSend,
  originFromReferer,
  parseWebsiteLead,
  type WebsiteLead,
} from "@/lib/website-intake";
import { DEFAULT_COMPANY } from "@/lib/templates/company";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RATE_LIMIT = 12;

export async function OPTIONS(request: Request) {
  const origin = allowedOrigin(request);
  if (!origin) return new Response(null, { status: 403 });
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}

export async function POST(request: Request) {
  const origin = allowedOrigin(request);
  if (!origin) {
    return textResponse(request, null, 403, "This form can only be sent from the Fast Break website.");
  }

  let fields: unknown;
  try {
    fields = await readBody(request);
  } catch {
    return textResponse(request, origin, 400, "That form could not be read. Please try again or call the office.");
  }

  const parsed = parseWebsiteLead(fields);
  const limited = await overRateLimit(request);
  if (limited) {
    return textResponse(request, origin, 429, "Please wait a little while and try again, or call the office.");
  }
  if (parsed.ok && parsed.spam) {
    return textResponse(request, origin, 200, "We have your quote request. A coordinator will contact you.", { ok: true });
  }
  if (!parsed.ok) {
    return textResponse(request, origin, 400, parsed.errors.join(" "));
  }

  const phone = await officePhone();
  let admin: ReturnType<typeof createSupabaseAdminClient>;
  try {
    admin = createSupabaseAdminClient();
  } catch (error) {
    console.error("[website-intake] database is not configured", error instanceof Error ? error.message : "error");
    return textResponse(request, origin, 503, `We could not save your request. Please call ${phone}.`, undefined, phone);
  }

  const lead = parsed.lead;
  const places = await Promise.all([placeForZip(lead.fromZip), placeForZip(lead.toZip)]);
  const { data: saved, error } = await admin.from("estimates").insert({
    owner_id: null,
    assigned_rep_id: null,
    status: "unassigned",
    priority: null,
    customer_name: lead.name,
    customer_email: lead.email,
    customer_phone: lead.phone1 || lead.phone2,
    lead_source: WEB_LEAD_SOURCE,
    primary_date: lead.transportDate,
    pickup_address: composeAddress("", places[0]?.city || "", places[0]?.state || "", lead.fromZip),
    pickup_zip: lead.fromZip,
    pickup_phone1: lead.phone1 || lead.phone2 || null,
    pickup_phone2: lead.phone1 && lead.phone2 ? lead.phone2 : null,
    delivery_address: composeAddress("", places[1]?.city || "", places[1]?.state || "", lead.toZip),
    delivery_zip: lead.toZip,
  }).select("id, job_number").single();

  if (error || !saved) {
    console.error("[website-intake] lead was not saved", error?.message || "no row");
    return textResponse(request, origin, 500, `We could not save your request. Please call ${phone}.`, undefined, phone);
  }

  if (lead.vehicles.length) {
    const { error: vehicleError } = await admin.from("vehicles").insert(lead.vehicles.map((vehicle) => ({
      estimate_id: saved.id,
      year: vehicle.year,
      make: vehicle.make || null,
      model: vehicle.model || null,
      vehicle_type: vehicle.type || null,
      is_running: vehicle.runs,
      is_enclosed: vehicle.closed,
    })));
    if (vehicleError) console.error("[website-intake] vehicles were not saved for", saved.job_number, vehicleError.message);
  }

  try {
    const miles = await milesForZips(lead.fromZip, lead.toZip);
    if (miles) await admin.from("estimates").update(miles).eq("id", saved.id);
  } catch (milesError) {
    console.error("[website-intake] mileage skipped", milesError instanceof Error ? milesError.message : "error");
  }

  await notify("unassigned_lead", `New website quote waiting to be assigned: ${jobLabel({ job_number: saved.job_number, customer_name: lead.name })}`, { id: saved.id, owner_id: null });

  const crmBase = (process.env.NEXT_PUBLIC_SITE_URL || new URL(request.url).origin).replace(/\/$/, "");
  const noticeError = await sendNotice(lead, saved.job_number || "", phone, `${crmBase}/estimates/${saved.id}`);
  await recordNotice(admin, saved.id, noticeError);

  const customer = `We have your quote request${saved.job_number ? ` (${saved.job_number})` : ""}. A coordinator will contact you.`;
  return textResponse(request, origin, 200, customer, {
    ok: true,
    jobNumber: saved.job_number,
    emailSent: !noticeError,
    ...(noticeError ? { emailError: noticeError } : {}),
  }, phone);
}

async function sendNotice(lead: WebsiteLead, jobNumber: string, phone: string, leadUrl: string): Promise<string | null> {
  try {
    const company = await getCompanyInfo();
    const from = sender(company);
    const notice = buildIntakeNotice(lead, jobNumber, phone, leadUrl);
    const result = await sendMail({
      from: { name: from.name, address: from.address },
      to: INTAKE_NOTICE_TO,
      replyTo: from.replyTo,
      subject: notice.subject,
      text: notice.text,
      html: intakeNoticeHtml(notice.text, LOGO_PATH),
    });
    const message = noticeErrorFromSend(result);
    if (message) console.error("[website-intake]", message, jobNumber, result && !result.ok ? result.error : "");
    return message;
  } catch (error) {
    console.error("[website-intake] notice email failed", jobNumber, error instanceof Error ? error.message : "error");
    return noticeErrorFromSend({ ok: false });
  }
}

async function recordNotice(admin: ReturnType<typeof createSupabaseAdminClient>, id: string, message: string | null) {
  const patch = message
    ? { intake_notice_error: message }
    : { intake_notice_error: null, intake_notice_sent_at: new Date().toISOString() };
  const { error } = await admin.from("estimates").update(patch).eq("id", id);
  if (error) console.error("[website-intake] could not store the email result on the lead", error.message);
  if (!message) return;
  const note = await admin.from("estimate_notes").insert({
    estimate_id: id,
    kind: "operations",
    author_name: "Website",
    body: message,
  });
  if (note.error) console.error("[website-intake] could not write the operations note", note.error.message);
}

async function overRateLimit(request: Request): Promise<boolean> {
  const key = intakeSourceKey(clientIpFromHeaders(request.headers));
  try {
    const admin = createSupabaseAdminClient();
    const since = new Date(Date.now() - INTAKE_RATE_WINDOW_MS).toISOString();
    const { count, error } = await admin.from("intake_rate_events").select("id", { count: "exact", head: true }).eq("source_key", key).gte("created_at", since);
    if (error) {
      console.error("[website-intake] rate table unavailable, using memory", error.message);
      return !consumeMemoryRate(key, Date.now()).allowed;
    }
    if (isOverIntakeRate(count ?? 0, RATE_LIMIT)) return true;
    const inserted = await admin.from("intake_rate_events").insert({ source_key: key });
    if (inserted.error) console.error("[website-intake] rate event was not stored", inserted.error.message);
    return false;
  } catch (error) {
    console.error("[website-intake] rate check failed, using memory", error instanceof Error ? error.message : "error");
    return !consumeMemoryRate(key, Date.now()).allowed;
  }
}

async function placeForZip(zip: string): Promise<{ city: string; state: string } | null> {
  try {
    const geo = await geoForZip(zip);
    if (geo?.city && geo.state) return { city: geo.city, state: geo.state };
  } catch (error) {
    console.error("[website-intake] ZIP place lookup skipped", error instanceof Error ? error.message : "error");
  }
  const place = await lookupZip(zip, 2000);
  return place ? { city: place.city, state: place.state } : null;
}

async function officePhone(): Promise<string> {
  try {
    return (await getCompanyInfo()).mainPhone || DEFAULT_COMPANY.mainPhone;
  } catch {
    return CRM_PHONE_DISPLAY;
  }
}

function allowedOrigin(request: Request): string | null {
  const origin = request.headers.get("origin") || originFromReferer(request.headers.get("referer"));
  const crm = [new URL(request.url).origin, process.env.NEXT_PUBLIC_SITE_URL || ""].filter(Boolean);
  return origin && isAllowedIntakeOrigin(origin, crm) ? origin : null;
}

async function readBody(request: Request): Promise<unknown> {
  const length = Number(request.headers.get("content-length") || 0);
  if (length > 50_000) throw new Error("too large");
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/json")) return request.json();
  const form = await request.formData();
  const fields: Record<string, string> = {};
  for (const [key, value] of form.entries()) {
    if (typeof value === "string") fields[key] = value;
  }
  return fields;
}

function corsHeaders(origin: string): Headers {
  const headers = new Headers();
  headers.set("access-control-allow-origin", origin);
  headers.set("access-control-allow-methods", "POST, OPTIONS");
  headers.set("access-control-allow-headers", "content-type");
  headers.set("vary", "Origin");
  return headers;
}

function textResponse(
  request: Request,
  origin: string | null,
  status: number,
  message: string,
  json?: Record<string, unknown>,
  phone = CRM_PHONE_DISPLAY,
) {
  const headers = origin ? corsHeaders(origin) : new Headers();
  headers.set("cache-control", "no-store");
  const wantsJson = (request.headers.get("content-type") || "").includes("application/json")
    || (request.headers.get("accept") || "").includes("application/json");
  if (wantsJson) {
    headers.set("content-type", "application/json");
    return new Response(JSON.stringify(json || { ok: false, error: message }), { status, headers });
  }
  headers.set("content-type", "text/html; charset=utf-8");
  const title = status === 200 ? "Quote request received" : "Quote request";
  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title></head><body style="font-family:Georgia,serif;max-width:36rem;margin:3rem auto;padding:0 1rem;color:#172033"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p><p>Fastbreak CRM<br>Phone: ${escapeHtml(phone)}</p></body></html>`;
  return new Response(html, { status, headers });
}
