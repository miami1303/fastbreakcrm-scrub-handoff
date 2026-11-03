"use server";

import { recheckNeedsCarrier } from "@/lib/needs-carrier-run";

import { isNoteKind, type NoteKind } from "@/lib/note-kinds";
import { LEAD_SOURCES_KEY, assignPanelFor, leadSourcesFrom } from "@/lib/lead-sources";
import { normalizeJobNumber } from "@/lib/job-number";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { getAccessibleEstimate, getStaff, isManager, jobLabel, notify, notifyUser, publicOrigin, type Staff } from "@/lib/crm-server";
import { docInput, loadLeadBundle } from "@/lib/lead-data";
import { listLeadPayments } from "@/lib/payments/records";
import { renderTemplate } from "@/lib/templates/registry";
import { activeBlock } from "@/lib/suppression";
import { geoForZip, milesForZips } from "@/lib/mileage-server";
import { composeAddress } from "@/lib/zip-lookup";
import { quickNotesFrom } from "@/lib/quick-notes";
import { digits } from "@/lib/crm-constants";
import { validatePriority } from "@/lib/follow-up-domain";
import { loadPriorityLabels } from "@/lib/priority-labels";
import { oneRepPatch } from "@/lib/one-rep";
import { extraChargesFrom, schemaFeatures } from "@/lib/schema-features";
import { cleanChargeLines, savedChargeLines, vehicleMoney } from "@/lib/vehicle-charges";
import { phoneForField } from "@/lib/phone-format";
import { priceCents, qtyOf, vehiclesCodCents } from "@/lib/pricing";
import { toCents } from "@/lib/money";
import { stripeConnected } from "@/lib/payments/provider";
import { describeVehiclePriceChanges, moneyFieldSet, resolveVehicleMoney, sameVehicleMoney, sumEnteredVehicles, vehicleDisplayName, vehicleMoneyError, type SplitVehicle } from "@/lib/vehicle-pricing";
import { isBlankHtml, sanitizeRichHtml } from "@/lib/templates/sanitize";

export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

type VehicleInput = { year?: string | number | null; make?: string; model?: string; vehicle_type?: string; is_running?: boolean; is_enclosed?: boolean; remarks?: string; color?: string; engine?: string; qty?: string | number; price?: string | number | null; deposit?: string | number | null; cod?: string | number | null; asap?: boolean; expedited?: boolean; charges?: { description?: string; amount?: string | number; collect?: string }[]; discount?: string | number | null };
const ENGINES = new Set(["Gas", "Diesel", "Hybrid", "Electric"]);

const text = (v: unknown, max = 500) => {
  const s = String(v ?? "").trim().slice(0, max);
  return s || null;
};
/** Store a phone as 303-555-1234. A note with no digits is kept. Blank becomes null. */
const phoneCol = (v: unknown) => text(phoneForField(v == null ? "" : String(v)), 40);
const cents = (v: unknown) => toCents(v);

async function requireStaff(): Promise<Staff> {
  const staff = await getStaff();
  if (!staff) throw new Error("Your session expired. Please sign in again.");
  return staff;
}

function fail(error: unknown): { ok: false; error: string } {
  const message = error instanceof Error ? error.message : "Something went wrong.";
  console.error("[crm]", message);
  return { ok: false, error: message };
}

/** Vehicles (no fixed limit; 100 is a sanity cap). extras = color/engine/qty/price columns exist. */
function vehicleRows(estimateId: string, vehicles: VehicleInput[], extras = false, pricing = false, persistMoney = false, expedited = false, charges = false) {
  return vehicles
    .filter(v => v.make || v.model || v.year)
    .slice(0, 100)
    .map(v => {
      const depositC = moneyFieldSet(v.deposit) ? (toCents(v.deposit) ?? 0) : 0;
      const codC = moneyFieldSet(v.cod) ? (toCents(v.cod) ?? 0) : 0;
      const hasMoney = moneyFieldSet(v.deposit) || moneyFieldSet(v.cod);
      // Per-vehicle Additional charges + Discount (migration 20261031190000). Lines were validated in saveLead.
      const lines = charges ? cleanChargeLines(v.charges, "Vehicle") : null;
      const saved = lines && lines.ok ? lines.lines : [];
      const vm = vehicleMoney({ deposit: depositC / 100, cod: codC / 100, charges: saved, discount: v.discount });
      return {
        ...(extras ? {
          color: text(v.color, 40),
          engine: ENGINES.has(String(v.engine)) ? String(v.engine) : null,
          qty: qtyOf(v),
          // Legacy per-unit carrier pay. Left as entered; the per-vehicle total is total_amount.
          price: priceCents(v) === null ? null : priceCents(v)! / 100,
        } : {}),
        ...(pricing ? {
          asap: !!v.asap,
          // Blank boxes stay NULL so an unpriced extra vehicle is not stored as an explicit $0.
          ...(persistMoney ? {
            deposit_amount: moneyFieldSet(v.deposit) ? depositC / 100 : null,
            cod_amount: moneyFieldSet(v.cod) ? codC / 100 : null,
            // Vehicle Total = Deposit + Carrier COD + Additional charges - Discount.
            total_amount: hasMoney || vm.extrasC > 0 ? vm.totalC / 100 : null,
          } : {}),
        } : {}),
        ...(charges ? { extra_charges: saved, discount_amount: vm.discountC > 0 ? vm.discountC / 100 : null } : {}),
        estimate_id: estimateId,
        year: v.year ? parseInt(String(v.year), 10) || null : null,
        make: text(v.make, 60),
        model: text(v.model, 60),
        vehicle_type: text(v.vehicle_type, 60), // free text: sedan, pickup, SUV, van, ATV, golf cart, trailer…
        is_running: v.is_running !== false,
        is_enclosed: !!v.is_enclosed,
        remarks: text(v.remarks, 500),
        ...(expedited ? { expedited: !!v.expedited } : {}), // only once the vehicles.expedited column exists
      };
    });
}

async function repById(repId: string | null) {
  if (!repId) return null;
  const admin = createSupabaseAdminClient();
  const { data } = await admin.from("crm_reps").select("id, name, user_id, is_active").eq("id", repId).maybeSingle();
  return data;
}

const timeOf = (v: unknown) => (/^\d{2}:\d{2}$/.test(String(v || "")) ? String(v) : null);

export async function listReps() {
  try {
    const staff = await requireStaff();
    const admin = createSupabaseAdminClient();
    const { data } = await admin.from("crm_reps").select("id, name, user_id, is_active, in_rotation").eq("is_active", true).order("sort_order").order("name");
    // New Estimate defaults to the creator's own rep (manual entries don't land in Assign New Estimates).
    const selfRepId = (data || []).find(r => r.user_id === staff.userId)?.id ?? null;
    const [{ data: rot }, { data: src }] = await Promise.all([
      admin.from("crm_settings").select("value").eq("key", "rotation_enabled").maybeSingle(),
      admin.from("crm_settings").select("value").eq("key", LEAD_SOURCES_KEY).maybeSingle(),
    ]);
    return { ok: true as const, reps: data || [], selfRepId, rotationEnabled: rot?.value === true, pickupTime: (await schemaFeatures()).pickupTime, leadSources: leadSourcesFrom(src?.value) };
  } catch (e) { return fail(e); }
}

/** New Estimate. assign = "rep:<id>" | "unassigned" | "rotation". */
export async function createEstimate(form: FormData): Promise<Result<{ id: string; job_number: string }>> {
  try {
    const staff = await requireStaff();
    const admin = createSupabaseAdminClient();
    const name = text(form.get("customer_name"), 120);
    const pickupZip = text(form.get("pickup_zip"), 10);
    const deliveryZip = text(form.get("delivery_zip"), 10);
    if (!name) return { ok: false, error: "Customer name is required." };
    if (!text(form.get("lead_source"), 120)) return { ok: false, error: "Pick a Lead Source." };
    if (!pickupZip || !/^\d{5}$/.test(pickupZip) || !deliveryZip || !/^\d{5}$/.test(deliveryZip)) {
      return { ok: false, error: "Enter a 5-digit pickup ZIP and delivery ZIP." };
    }
    const assign = String(form.get("assign") || "");
    let rep: { id: string; name: string; user_id: string | null } | null = null;
    let status = "draft";
    let viaRotation = false;
    if (assign.startsWith("rep:")) {
      rep = await repById(assign.slice(4));
      if (!rep) return { ok: false, error: "Pick a rep or Assign New Estimates." };
    } else if (assign === "rotation") {
      const { data: repId } = await admin.rpc("crm_next_rotation_rep");
      rep = repId ? await repById(repId as string) : null;
      viaRotation = !!rep;
      if (!rep) status = "unassigned";
    } else {
      status = "unassigned";
    }

    const addr = (side: "pickup" | "delivery", zip: string) =>
      composeAddress(String(form.get(`${side}_address`) || ""), String(form.get(`${side}_city`) || ""), String(form.get(`${side}_state`) || "").toUpperCase(), zip);

    const features = await schemaFeatures();
    const insert: Record<string, unknown> = {
      owner_id: rep?.user_id ?? null,
      assigned_rep_id: rep?.id ?? null,
      created_by: staff.userId,
      status,
      priority: null,
      customer_name: name,
      customer_email: text(form.get("customer_email"), 200),
      customer_phone: phoneCol(form.get("customer_phone")),
      lead_source: text(form.get("lead_source"), 120),
      primary_date: text(form.get("primary_date"), 10),
      backup_date: text(form.get("backup_date"), 10),
      pickup_address: addr("pickup", pickupZip),
      pickup_zip: pickupZip,
      pickup_contact: text(form.get("pickup_contact"), 120),
      pickup_phone1: phoneCol(form.get("pickup_phone1")),
      pickup_phone2: phoneCol(form.get("pickup_phone2")),
      delivery_address: addr("delivery", deliveryZip),
      delivery_zip: deliveryZip,
      delivery_contact: text(form.get("delivery_contact"), 120),
      delivery_phone1: phoneCol(form.get("delivery_phone1")),
      delivery_phone2: phoneCol(form.get("delivery_phone2")),
    };
    // Labels save only after migration 20261026210000. Until then the numbers still save.
    if (features.phoneLabels) {
      insert.pickup_phone1_label = text(form.get("pickup_phone1_label"), 20);
      insert.pickup_phone2_label = text(form.get("pickup_phone2_label"), 20);
      insert.delivery_phone1_label = text(form.get("delivery_phone1_label"), 20);
      insert.delivery_phone2_label = text(form.get("delivery_phone2_label"), 20);
    }
    // Phone 3 saves only after migration 20261026230000. Until then phones 1 and 2 still save.
    if (features.phone3) {
      insert.pickup_phone3 = phoneCol(form.get("pickup_phone3"));
      insert.delivery_phone3 = phoneCol(form.get("delivery_phone3"));
      insert.pickup_phone3_label = text(form.get("pickup_phone3_label"), 20);
      insert.delivery_phone3_label = text(form.get("delivery_phone3_label"), 20);
    }
    const { data: est, error } = await admin.from("estimates").insert(insert).select("id, job_number, owner_id").single();
    if (error || !est) throw new Error(error?.message || "Could not save the estimate.");

    // Pickup time (column from migration 20261023200000; ignored until it is applied).
    const pt = timeOf(form.get("pickup_time"));
    if (pt) await admin.from("estimates").update({ pickup_time: pt }).eq("id", est.id).then(() => null, () => null);

    // Mileage (free sources; never blocks saving the lead).
    const m = await milesForZips(pickupZip, deliveryZip).catch(() => null);
    if (m) await admin.from("estimates").update(m).eq("id", est.id);

    let vehicles: VehicleInput[] = [];
    try { vehicles = JSON.parse(String(form.get("vehicles") || "[]")); } catch { vehicles = []; }
    const rows = vehicleRows(est.id, vehicles, features.vehicleExtras, features.vehiclePricing, features.vehiclePricing && vehicles.some(v => moneyFieldSet(v.deposit) || moneyFieldSet(v.cod)), !!features.vehicleExpedited);
    if (rows.length) await admin.from("vehicles").insert(rows);

    const label = jobLabel({ job_number: est.job_number, customer_name: name });
    if (status === "unassigned") {
      await notify("unassigned_lead", `New estimate waiting to be assigned: ${label}`, null);
    } else if (rep?.user_id && (viaRotation || rep.user_id !== staff.userId)) {
      await notifyUser("new_lead", `New lead for ${rep.name}${viaRotation ? " (rotation)" : ""}: ${label}`, { id: est.id }, rep.user_id);
    }
    return { ok: true, id: est.id, job_number: est.job_number };
  } catch (e) { return fail(e); }
}

/** Everything the salesman lead page needs, loaded server-side after an access check. */
export async function loadLead(estimateId: string) {
  try {
    const staff = await requireStaff();
    if (!(await getAccessibleEstimate(staff, estimateId))) return { ok: false as const, error: "Estimate not found or not yours." };
    const bundle = await loadLeadBundle(estimateId);
    if (!bundle) return { ok: false as const, error: "Estimate not found." };
    const admin = createSupabaseAdminClient();
    const [{ data: reps }, { data: notes }, { data: emails }, { data: events }, { data: payments }, { data: history }, labels] = await Promise.all([
      admin.from("crm_reps").select("id, name, user_id, is_active").eq("is_active", true).order("sort_order"),
      admin.from("estimate_notes").select("id, created_at, author_name, body, kind").eq("estimate_id", estimateId).order("created_at", { ascending: false }),
      admin.from("crm_emails").select("id, created_at, kind, subject, sent_to, sent_cc, sent_by_name, seq, html_snapshot, token").eq("estimate_id", estimateId).order("created_at", { ascending: false }),
      admin.from("crm_email_events").select("email_id, event, created_at, ip, signer_name, signer_email, block_id, actor_name").eq("estimate_id", estimateId).order("created_at"),
      listLeadPayments(admin, estimateId).then(data => ({ data })),
      admin.from("estimate_price_history").select("created_at, changed_by_name, old_total, new_total, old_deposit, new_deposit").eq("estimate_id", estimateId).order("created_at", { ascending: false }).limit(50),
      loadPriorityLabels(),
    ]);
    const { data: extraHistory } = await admin.from("estimate_extra_notes_history").select("id, created_at, edited_by_name, html, field").eq("estimate_id", estimateId).order("created_at", { ascending: false }).limit(50);
    const { data: quick } = await admin.from("crm_settings").select("value").eq("key", "quick_notes").maybeSingle();
    const { data: srcSetting } = await admin.from("crm_settings").select("value").eq("key", LEAD_SOURCES_KEY).maybeSingle();
    const [pickupGeo, deliveryGeo] = await Promise.all([geoForZip(bundle.est.pickup_zip).catch(() => null), geoForZip(bundle.est.delivery_zip).catch(() => null)]);
    const { data: statusLog } = await admin.from("estimate_status_log").select("created_at, action, from_status, to_status, actor_name").eq("estimate_id", estimateId).order("created_at", { ascending: false }).limit(50);
    const origin = await publicOrigin();
    const emailRows = (emails || []).map(({ html_snapshot, token: _token, ...m }) => {
      void _token;
      const ev = (events || []).filter(e => e.email_id === m.id);
      const opened = ev.find(e => e.event === "opened");
      const quoteViewed = ev.find(e => e.event === "viewed");
      const signed = ev.find(e => e.event === "signed");
      const viewed = ev.find(e => e.event === "viewed") || ev.find(e => e.event === "opened");
      const optout = ev.filter(e => e.event === "unsubscribed" || e.event === "block_removed")
        .map(e => ({ event: e.event as "unsubscribed" | "block_removed", at: e.created_at, block_id: e.block_id as number | null, by: e.actor_name as string | null, ip: e.ip }));
      return { ...m, has_snapshot: !!html_snapshot, opened_at: opened?.created_at || null, quote_viewed_at: quoteViewed?.created_at || null, signer_email: signed?.signer_email || null, optout, signed_at: signed?.created_at || null, signer_name: signed?.signer_name || null, signed_ip: signed?.ip || null, viewed_at: viewed?.created_at || null, viewed_ip: viewed?.ip || null };
    });
    // "Copy customer link" in the Email Center: the newest sent quote / e-sign / CC email's own
    // tracked link (/d/<job>/<token>), so a pasted link still records that email's views.
    const latestDoc = (emails || []).find(m => ["e_quote", "booked_esign", "cc_form"].includes(m.kind) && m.token);
    const customerLink = latestDoc ? `${origin}/d/${encodeURIComponent(bundle.est.job_number || "")}/${latestDoc.token}` : null;
    const quoteSigned = emailRows.find(m => m.kind === "booked_esign" && m.signed_at) || null;
    const ccSigned = emailRows.find(m => m.kind === "cc_form" && m.signed_at) || null;
    return {
      ok: true as const,
      staff: { userId: staff.userId, name: staff.name, role: staff.role, canViewCards: staff.canViewCards, isManager: isManager(staff) },
      ...bundle,
      features: await schemaFeatures(),
      extraCharges: extraChargesFrom((bundle.quote as { extra_charges?: unknown } | null)?.extra_charges),
      reps: reps || [],
      notes: notes || [],
      emails: emailRows,
      customerLink,
      payments: payments || [],
      autoCharge: {
        on: !!(bundle.est as { auto_charge?: boolean | null }).auto_charge,
        stripeConnected: stripeConnected(),
        hasCard: !!(bundle.quote?.card_last4) || (payments || []).some(p => !p.voided_at && !!p.card_last4),
      },
      priceHistory: history || [],
      priorityLabels: labels,
      esign: { quoteSignedAt: quoteSigned?.signed_at || null, ccSignedAt: ccSigned?.signed_at || null },
      block: await activeBlock(bundle.est.customer_email),
      statusLog: statusLog || [],
      quickNotes: quickNotesFrom(quick?.value),
      leadSources: leadSourcesFrom(srcSetting?.value),
      geo: { pickup: pickupGeo, delivery: deliveryGeo },
      extraNotes: { html: bundle.est.extra_stop_html ? sanitizeRichHtml(bundle.est.extra_stop_html) : "", legacy: bundle.est.extra_stop_notes || "", history: (extraHistory || []).filter(h => h.field === "extra_stop" || !h.field).map(({ html, field: _f, ...h }) => ({ ...h, cleared: !html })) },
      remarksHistory: (extraHistory || []).filter(h => h.field === "remarks").map(({ html, field: _f, ...h }) => ({ ...h, text: html || "" })),
      changeLog: (extraHistory || []).filter(h => h.field === "vehicles" || h.field === "extra_charges").map(({ html, ...h }) => ({ ...h, text: html || "" })),
      docs: {
        quote: renderTemplate("e_quote", docInput(bundle, origin, "e_quote")).html,
        booked: renderTemplate("booked_esign", docInput(bundle, origin, "booked")).html,
        cc: renderTemplate("cc_form", docInput(bundle, origin, "cc")).html,
      },
    };
  } catch (e) { return fail(e); }
}

export type LeadSave = {
  customer_name: string; customer_email: string; customer_phone: string; lead_source: string;
  pickup_street: string; pickup_city: string; pickup_state: string; pickup_zip: string; pickup_contact: string; pickup_phone1: string; pickup_phone2: string; pickup_phone3?: string;
  pickup_phone1_label?: string; pickup_phone2_label?: string; pickup_phone3_label?: string;
  delivery_street: string; delivery_city: string; delivery_state: string; delivery_zip: string; delivery_contact: string; delivery_phone1: string; delivery_phone2: string; delivery_phone3?: string;
  delivery_phone1_label?: string; delivery_phone2_label?: string; delivery_phone3_label?: string;
  primary_date: string; backup_date: string;
  /** "HH:MM"; saved only when the pickup_time column exists (migration 20261023200000). */
  pickup_time?: string;
  /** Miles box on the lead; a typed value different from the stored one is a manual override. */
  miles?: string;
  assigned_rep_id: string;
  /** Extra Stop / Notes HTML; undefined = unchanged. Sanitized here; blank clears the section. */
  extra_stop_html?: string;
  /** Shared shipment Remarks (plain text); only sent when changed. */
  shipment_remarks?: string;
  deposit: string; cod: string;
  /** Up to 3 optional extra charge lines {description, amount}; undefined = unchanged. */
  extra_charges?: { description: string; amount: string }[];
  vehicles: VehicleInput[];
};

/** "Save Charges": saves prices, vehicles, dates and every lead field in one go. */
export async function saveLead(estimateId: string, data: LeadSave): Promise<Result> {
  try {
    const staff = await requireStaff();
    const current = await getAccessibleEstimate(staff, estimateId);
    if (!current) return { ok: false, error: "Estimate not found or not yours." };
    const bundle = await loadLeadBundle(estimateId);
    if (!bundle) return { ok: false, error: "Estimate not found." };
    const admin = createSupabaseAdminClient();
    // TOTAL = DEPOSIT (quoted) + COD (paid to the carrier on delivery), in integer cents.
    const depositC = cents(data.deposit);
    const codC = cents(data.cod);
    if (String(data.deposit ?? "").trim() && depositC === null) return { ok: false, error: "Deposit must be a dollar amount (e.g. 200 or 200.00)." };
    if (String(data.cod ?? "").trim() && codC === null) return { ok: false, error: "COD must be a dollar amount (e.g. 1050 or 1050.00)." };
    if ((depositC ?? 0) < 0 || (codC ?? 0) < 0) return { ok: false, error: "Deposit and COD can't be negative." };
    // Extra charge lines (optional, positive, max 3). Blank lines are dropped.
    const features = await schemaFeatures();
    const prevExtras = extraChargesFrom((bundle.quote as { extra_charges?: unknown } | null)?.extra_charges);
    let extras = prevExtras;
    if (data.extra_charges !== undefined && features.extraCharges) {
      extras = [];
      for (const [i, line] of (data.extra_charges || []).slice(0, 3).entries()) {
        const d = String(line?.description ?? "").trim(), a = String(line?.amount ?? "").trim();
        if (!d && !a) continue;
        const c = cents(a);
        if (!d) return { ok: false, error: `Extra charge ${i + 1}: add a description.` };
        if (c === null || c <= 0) return { ok: false, error: `Extra charge ${i + 1}: the amount must be a positive dollar amount.` };
        extras.push({ description: d.slice(0, 80), amount: c / 100 });
      }
    }
    // Job deposit / COD / total. With per-vehicle prices (migration 20261027010000) the job
    // numbers are the sums of the vehicle boxes, plus extra charges once. Until someone edits
    // a vehicle price, a legacy job whose saved COD does not match price × qty keeps that COD.
    const listed = (data.vehicles || []).filter(v => v.make || v.model || v.year);
    let depositCents = depositC;
    let codUsed: number | null = codC;
    let persistMoney = false;
    let priceChangeLines: string[] = [];
    if (features.vehiclePricing && listed.length) {
      for (const [i, v] of listed.entries()) {
        const err = vehicleMoneyError(v, vehicleDisplayName(v, i));
        if (err) return { ok: false, error: err };
      }
      const oldDep = bundle.quote?.deposit_amount ?? bundle.est.deposit_amount;
      const oldCod = bundle.quote?.cod_amount ?? bundle.est.cod_amount;
      const dbVehicles: SplitVehicle[] = bundle.vehicles.map(v => {
        const row = v as typeof v & { deposit_amount?: unknown; cod_amount?: unknown; price?: unknown; qty?: unknown };
        return { year: row.year, make: row.make, model: row.model, price: row.price, qty: row.qty, deposit: row.deposit_amount ?? "", cod: row.cod_amount ?? "" };
      });
      const baseline = resolveVehicleMoney(dbVehicles, oldDep, oldCod, prevExtras);
      const incoming = resolveVehicleMoney(listed, data.deposit, data.cod, extras);
      const same = sameVehicleMoney(baseline.vehicles, incoming.vehicles);
      if (!(baseline.mode === "legacy-mismatch" && same)) {
        persistMoney = true;
        const sums = sumEnteredVehicles(listed);
        const anyBox = listed.some(v => moneyFieldSet(v.deposit) || moneyFieldSet(v.cod));
        depositCents = anyBox ? sums.depositC : null;
        codUsed = anyBox ? sums.codC : null;
        const after = resolveVehicleMoney(listed, depositCents === null ? "" : depositCents / 100, codUsed === null ? "" : codUsed / 100, extras);
        priceChangeLines = describeVehiclePriceChanges(
          baseline.vehicles.map((r, i) => ({ ...dbVehicles[i], depositC: r.depositC, codC: r.codC })),
          after.vehicles.map((r, i) => ({ ...listed[i], depositC: r.depositC, codC: r.codC })),
        );
      }
    } else {
      // A blank COD defaults to the vehicles' legacy carrier pay (sum of price × qty).
      const vehCod = features.vehicleExtras ? vehiclesCodCents(data.vehicles || []) : null;
      codUsed = codC ?? vehCod;
    }
    // Per-vehicle Additional charges + Discount (Owner 2026-10-31). Each vehicle:
    //   Total = Deposit + Carrier COD + Additional charges - Discount. The job Total is the sum.
    //   Discount comes off what Fast Break collects (deposit + charges taken by payment);
    //   the Carrier COD stays the same, so a bigger discount is refused.
    let vehExtrasC = 0, vehDiscountC = 0;
    const perVehicle = !!features.vehicleCharges && listed.length > 0;
    if (perVehicle) {
      for (const [i, v] of listed.entries()) {
        const name = vehicleDisplayName(v, i);
        const lines = cleanChargeLines(v.charges, name);
        if (!lines.ok) return { ok: false, error: lines.error };
        if (moneyFieldSet(v.discount) && (toCents(v.discount) === null || (toCents(v.discount) ?? 0) < 0)) return { ok: false, error: `${name}: Discount must be a dollar amount (e.g. 50 or 50.00).` };
        const m = vehicleMoney({ deposit: v.deposit, cod: v.cod, charges: lines.lines, discount: v.discount });
        // Legacy-mismatch jobs keep the job deposit on vehicle 1 only.
        const depForCheck = !persistMoney && i === 0 && listed.length && depositCents !== null ? depositCents : m.depositC;
        if (m.discountC > depForCheck + m.extrasPayC) {
          return { ok: false, error: `${name}: the Discount (${(m.discountC / 100).toFixed(2)}) is more than the Deposit + Additional charges taken by payment (${((depForCheck + m.extrasPayC) / 100).toFixed(2)}). The Carrier COD stays the same, so the discount can't come out of it.` };
        }
        vehExtrasC += m.extrasC;
        vehDiscountC += m.discountC;
      }
      // Old job-level extra lines are moved onto vehicle 1 by the Charges form; once saved per vehicle they are cleared here.
      if (data.extra_charges === undefined) extras = [];
    }
    const exAllC = extras.reduce((t, x) => t + Math.round(x.amount * 100), 0) + vehExtrasC;
    const hasPrice = depositCents !== null || codUsed !== null || exAllC > 0;
    const deposit = depositCents === null ? null : depositCents / 100;
    const cod = codUsed === null ? null : codUsed / 100;
    const total = hasPrice ? ((depositCents ?? 0) + (codUsed ?? 0) + exAllC - vehDiscountC) / 100 : null;
    if (!text(data.customer_name)) return { ok: false, error: "Customer name is required." };

    const update: Record<string, unknown> = {
      customer_name: text(data.customer_name, 120),
      customer_email: text(data.customer_email, 200),
      customer_phone: phoneCol(data.customer_phone),
      lead_source: text(data.lead_source, 120),
      pickup_address: composeAddress(data.pickup_street || "", data.pickup_city || "", (data.pickup_state || "").toUpperCase(), data.pickup_zip || ""),
      pickup_zip: text(data.pickup_zip, 10),
      pickup_contact: text(data.pickup_contact, 120),
      pickup_phone1: phoneCol(data.pickup_phone1),
      pickup_phone2: phoneCol(data.pickup_phone2),
      delivery_address: composeAddress(data.delivery_street || "", data.delivery_city || "", (data.delivery_state || "").toUpperCase(), data.delivery_zip || ""),
      delivery_zip: text(data.delivery_zip, 10),
      delivery_contact: text(data.delivery_contact, 120),
      delivery_phone1: phoneCol(data.delivery_phone1),
      delivery_phone2: phoneCol(data.delivery_phone2),
      ...(features.phoneLabels ? {
        pickup_phone1_label: text(data.pickup_phone1_label, 20),
        pickup_phone2_label: text(data.pickup_phone2_label, 20),
        delivery_phone1_label: text(data.delivery_phone1_label, 20),
        delivery_phone2_label: text(data.delivery_phone2_label, 20),
      } : {}),
      ...(features.phone3 ? {
        pickup_phone3: phoneCol(data.pickup_phone3),
        delivery_phone3: phoneCol(data.delivery_phone3),
        pickup_phone3_label: text(data.pickup_phone3_label, 20),
        delivery_phone3_label: text(data.delivery_phone3_label, 20),
      } : {}),
      primary_date: text(data.primary_date, 10),
      backup_date: text(data.backup_date, 10),
      deposit_amount: deposit,
      cod_amount: cod,
      total_amount: total,
      updated_at: new Date().toISOString(),
    };
    if ("pickup_time" in bundle.est && data.pickup_time !== undefined) update.pickup_time = timeOf(data.pickup_time);
    if (bundle.est.status === "draft" && total) update.status = "quoted";

    // Extra Stop / Notes (rich text from the modal). Saved with Submit Charges; each change logged.
    let extraChange: string | null | undefined;
    if (data.extra_stop_html !== undefined) {
      if (String(data.extra_stop_html).length > 60_000) return { ok: false, error: "Extra Stop / Notes is too long." };
      const clean = sanitizeRichHtml(data.extra_stop_html);
      const value = isBlankHtml(clean) ? null : clean;
      const before = bundle.est.extra_stop_html ? sanitizeRichHtml(bundle.est.extra_stop_html) : null;
      if (value !== before || (value === null && bundle.est.extra_stop_notes)) {
        update.extra_stop_html = value;
        update.extra_stop_notes = null;
        extraChange = value;
      }
    }

    // Shared shipment Remarks (plain text). Saved with Submit Charges; each change logged.
    let remarksChange: string | null | undefined;
    if (data.shipment_remarks !== undefined) {
      const value = String(data.shipment_remarks).replace(/\r\n?/g, "\n").trim().slice(0, 4000) || null;
      if (value !== (bundle.est.shipment_remarks?.trim() || null)) { update.shipment_remarks = value; remarksChange = value; }
    }

    // Representative selector
    const newRepId = data.assigned_rep_id || null;
    let newRep: Awaited<ReturnType<typeof repById>> = null;
    if (newRepId !== (bundle.est.assigned_rep_id || null)) {
      newRep = await repById(newRepId);
      update.assigned_rep_id = newRep?.id ?? null;
      update.owner_id = newRep?.user_id ?? (isManager(staff) ? null : staff.userId);
      if (newRep && bundle.est.status === "unassigned") update.status = total ? "quoted" : "draft";
    }

    // Miles: recalculated whenever either ZIP changes; otherwise a changed Miles box = rep override.
    const pz = text(data.pickup_zip, 10), dz = text(data.delivery_zip, 10);
    const pair = pz && dz ? `${pz}-${dz}` : null;
    const prev = bundle.est;
    if (pair && pair !== prev.miles_zips) {
      const m = await milesForZips(pz, dz).catch(() => null);
      if (m) Object.assign(update, m);
    } else if (data.miles !== undefined && String(data.miles).trim() !== String(prev.miles ?? "")) {
      const typed = String(data.miles).replace(/[,\s]|miles?/gi, "");
      if (typed === "") Object.assign(update, { miles: null, miles_source: null });
      else if (/^\d{1,5}$/.test(typed) && Number(typed) <= 10000) Object.assign(update, { miles: Number(typed), miles_source: "manual", miles_zips: pair });
      else return { ok: false, error: "Miles must be a whole number (e.g. 584)." };
    }
    const { error } = await admin.from("estimates").update(update).eq("id", estimateId);
    if (error) throw new Error(error.message);
    // Pickup window changed -> a raised "Needs carrier" banner clears (and re-raises only if the new window is also 2+ days past).
    if ((bundle.est.primary_date || null) !== (update.primary_date ?? null) || (bundle.est.backup_date || null) !== (update.backup_date ?? null)) await recheckNeedsCarrier(estimateId);

    const dollars = (v: unknown) => {
      if (v === null || v === undefined || v === "") return "";
      const c = toCents(v);
      return c === null ? "" : `$${(c / 100).toFixed(2)}`;
    };
    const vehicleSummary = (list: { extra_charges?: unknown; charges?: unknown; discount_amount?: unknown; discount?: unknown; year?: unknown; make?: unknown; model?: unknown; vehicle_type?: unknown; is_running?: unknown; is_enclosed?: unknown; remarks?: unknown; color?: unknown; engine?: unknown; qty?: unknown; price?: unknown; asap?: unknown; expedited?: unknown; deposit?: unknown; cod?: unknown; deposit_amount?: unknown; cod_amount?: unknown; total_amount?: unknown }[]) =>
      list.map(v => {
        const dep = v.deposit_amount ?? v.deposit;
        const codAmt = v.cod_amount ?? v.cod;
        const tot = v.total_amount ?? (moneyFieldSet(dep) || moneyFieldSet(codAmt) ? ((toCents(dep) ?? 0) + (toCents(codAmt) ?? 0)) / 100 : "");
        const money = features.vehiclePricing && (moneyFieldSet(dep) || moneyFieldSet(codAmt))
          ? `Deposit ${dollars(dep)} · Carrier COD ${dollars(codAmt)} · Total ${dollars(tot)}`
          : v.price != null && v.price !== "" ? `$${Number(v.price).toFixed(2)}` : "";
        return [[v.year, v.make, v.model].filter(Boolean).join(" "), v.color, v.vehicle_type, v.engine, v.is_running === false ? "not running" : "running", v.is_enclosed ? "enclosed" : "open",
          Number(v.qty ?? 1) > 1 ? `qty ${v.qty}` : "", money, chargesText(v), v.asap ? "ASAP" : "", v.expedited ? "EXPEDITED" : "", v.remarks].filter(Boolean).join(" · ");
      }).join("\n");
    // Per-vehicle Additional charges / Discount in the charges history (saved rows or form lines).
    function chargesText(v: { extra_charges?: unknown; charges?: unknown; discount_amount?: unknown; discount?: unknown }): string {
      if (!perVehicle) return "";
      const raw = v.extra_charges !== undefined ? v.extra_charges : (cleanChargeLines(v.charges as VehicleInput["charges"], "Vehicle") as { lines?: unknown }).lines;
      const lines = savedChargeLines(raw).map(l => `+ ${l.description} ${dollars(l.amount)}${l.collect === "cod" ? " (carrier COD)" : ""}`);
      const disc = toCents(v.discount_amount ?? v.discount) ?? 0;
      return [...lines, disc > 0 ? `Discount -${dollars(disc / 100)}` : ""].filter(Boolean).join(" · ");
    }
    const beforeVehicles = vehicleSummary(bundle.vehicles);
    await admin.from("vehicles").delete().eq("estimate_id", estimateId);
    const rows = vehicleRows(estimateId, data.vehicles || [], features.vehicleExtras, features.vehiclePricing, persistMoney, !!features.vehicleExpedited, perVehicle);
    if (rows.length) await admin.from("vehicles").insert(rows);
    const afterVehicles = vehicleSummary(rows);

    if (hasPrice) {
      const { error: qErr } = await admin.from("quotes").upsert(
        { estimate_id: estimateId, total_amount: total ?? 0, deposit_amount: deposit ?? 0, cod_amount: cod ?? 0, ...(features.extraCharges ? { extra_charges: extras } : {}) },
        { onConflict: "estimate_id" },
      );
      if (qErr) throw new Error(qErr.message);
    } else if (features.extraCharges && bundle.quote && prevExtras.length) {
      await admin.from("quotes").update({ extra_charges: [] }).eq("estimate_id", estimateId);
    }
    // Vehicle and extra-charge edits go to the append-only charges history (needs the
    // 'vehicles' / 'extra_charges' field values from migration 20261023200000; skipped before).
    const logField = async (field: string, text: string) => {
      await admin.from("estimate_extra_notes_history").insert({ estimate_id: estimateId, field, html: text, edited_by: staff.userId, edited_by_name: staff.name }).then(() => null, () => null);
    };
    if (beforeVehicles !== afterVehicles || priceChangeLines.length) {
      const vehicleLog = [...priceChangeLines, afterVehicles].filter(Boolean).join("\n");
      await logField("vehicles", vehicleLog || "(no vehicles)");
    }
    const extrasText = (x: typeof extras) => x.map(l => `${l.description}: $${l.amount.toFixed(2)}`).join("\n");
    if (extrasText(prevExtras) !== extrasText(extras)) await logField("extra_charges", extrasText(extras) || "(none)");
    const oldTotal = bundle.quote ? Number(bundle.quote.total_amount) : bundle.est.total_amount;
    const oldDeposit = bundle.quote ? Number(bundle.quote.deposit_amount) : bundle.est.deposit_amount;
    if (toCents(oldTotal) !== toCents(total) || toCents(oldDeposit) !== toCents(deposit)) {
      await admin.from("estimate_price_history").insert({
        estimate_id: estimateId, changed_by: staff.userId, changed_by_name: staff.name,
        old_total: oldTotal ?? null, new_total: total, old_deposit: oldDeposit ?? null, new_deposit: deposit,
      });
    }
    if (extraChange !== undefined) {
      await admin.from("estimate_extra_notes_history").insert({ estimate_id: estimateId, html: extraChange || "", edited_by: staff.userId, edited_by_name: staff.name });
    }
    if (remarksChange !== undefined) {
      await admin.from("estimate_extra_notes_history").insert({ estimate_id: estimateId, field: "remarks", html: remarksChange || "", edited_by: staff.userId, edited_by_name: staff.name });
    }
    if (newRep?.user_id && newRep.user_id !== staff.userId) {
      await notifyUser("new_lead", `New lead for ${newRep.name}: ${jobLabel(bundle.est)}`, { id: estimateId }, newRep.user_id);
    }
    return { ok: true };
  } catch (e) { return fail(e); }
}

export async function setFollowUp(estimateId: string, iso: string | null): Promise<Result> {
  try {
    const staff = await requireStaff();
    if (!(await getAccessibleEstimate(staff, estimateId))) return { ok: false, error: "Estimate not found." };
    const when = iso ? new Date(iso) : null;
    if (when && Number.isNaN(when.getTime())) return { ok: false, error: "Invalid follow-up date/time." };
    const admin = createSupabaseAdminClient();
    const { error } = await admin.from("estimates").update({ follow_up_at: when ? when.toISOString() : null }).eq("id", estimateId);
    if (error) return { ok: false, error: "The follow-up date could not be saved." };
    return { ok: true };
  } catch (e) { return fail(e); }
}

/** Saves immediately. NOT a "touch": only an email or a note clears a due follow-up. Blank is allowed. */
export async function setPriority(estimateId: string, priority: number | null): Promise<Result> {
  try {
    const staff = await requireStaff();
    if (!(await getAccessibleEstimate(staff, estimateId))) return { ok: false, error: "Estimate not found." };
    const admin = createSupabaseAdminClient();
    const [{ data: row }, labels] = await Promise.all([
      admin.from("estimates").select("priority").eq("id", estimateId).maybeSingle(),
      loadPriorityLabels(),
    ]);
    let next: number | null;
    try {
      next = validatePriority(priority, labels, (row?.priority as number | null) ?? null);
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "That priority can't be saved." };
    }
    const { error } = await admin.from("estimates").update({ priority: next }).eq("id", estimateId);
    if (error) {
      return { ok: false, error: /check|priority/i.test(error.message)
        ? "That priority could not be saved. Apply migration 20261027120000_priority_labels.sql if this number is new (9)."
        : "The priority could not be saved." };
    }
    return { ok: true };
  } catch (e) { return fail(e); }
}

/** Rep note (timestamp + rep name). Counts as touching the lead (clears a due follow-up). */
export type { NoteKind };
/**
 * Append-only note entry (timestamp + rep). Any of the four sections counts as touching
 * the lead, which clears a due follow-up. "policy" entries print in this lead's T&C.
 */
export async function addNote(estimateId: string, body: string, kind: NoteKind = "rep"): Promise<Result> {
  try {
    const staff = await requireStaff();
    if (!(await getAccessibleEstimate(staff, estimateId))) return { ok: false, error: "Estimate not found." };
    if (!isNoteKind(kind)) return { ok: false, error: "Unknown note section." };
    const note = text(body, 4000);
    if (!note) return { ok: false, error: "Write a note first." };
    const admin = createSupabaseAdminClient();
    await admin.from("estimate_notes").insert({ estimate_id: estimateId, kind, created_by: staff.userId, author_name: staff.name, body: note });
    const now = new Date().toISOString();
    await admin.from("estimates").update({ last_touched_at: now }).eq("id", estimateId);
    // Carrier Info on a BOOKED job = carrier assigned: stamp it and raise the "Job Assigned" banner
    // (stays until someone opens the lead). Reassigns stamp again.
    if (kind === "carrier") {
      const { data: est } = await admin.from("estimates").select("id, owner_id, status, job_number, customer_name").eq("id", estimateId).maybeSingle();
      if (est?.status === "booked") {
        await admin.from("estimates").update({ carrier_assigned_at: now }).eq("id", estimateId); // no-op error if migration not applied
        await notify("job_assigned", `Job Assigned: ${jobLabel(est)}`, est);
        await recheckNeedsCarrier(estimateId); // carrier assigned -> "Needs carrier" banner clears
      }
    }
    return { ok: true };
  } catch (e) { return fail(e); }
}

/** Book Job: off the follow-up list, onto the Operations calendar (Primary Date). */
async function logStatus(estimateId: string, action: "booked" | "release_book" | "cancelled" | "reopened", from: string | null, to: string, staff: Staff) {
  await createSupabaseAdminClient().from("estimate_status_log").insert({ estimate_id: estimateId, action, from_status: from, to_status: to, actor: staff.userId, actor_name: staff.name });
}

export async function bookJob(estimateId: string): Promise<Result> {
  try {
    const staff = await requireStaff();
    const row = await getAccessibleEstimate(staff, estimateId);
    if (!row) return { ok: false, error: "Estimate not found." };
    if (row.status === "cancelled") return { ok: false, error: "This lead is cancelled. Reopen it first." };
    const bundle = await loadLeadBundle(estimateId);
    if (!bundle) return { ok: false, error: "Estimate not found." };
    if (!(Number(bundle.quote?.total_amount) > 0)) return { ok: false, error: "Enter the Total and click Save Charges before booking." };
    const now = new Date().toISOString();
    const admin = createSupabaseAdminClient();
    await admin.from("estimates").update({ status: "booked", booked_at: now }).eq("id", estimateId);
    await admin.from("quotes").update({ booked_at: now }).eq("estimate_id", estimateId);
    await logStatus(estimateId, "booked", row.status, "booked", staff);
    return { ok: true };
  } catch (e) { return fail(e); }
}

/** RELEASE BOOK (admin only): un-book. Back to follow-up, off the Operations calendar, logged. */
export async function releaseBook(estimateId: string): Promise<Result> {
  try {
    const staff = await requireStaff();
    if (staff.role !== "admin") return { ok: false, error: "Only an admin can release a booking." };
    const row = await getAccessibleEstimate(staff, estimateId);
    if (!row) return { ok: false, error: "Estimate not found." };
    if (row.status !== "booked") return { ok: false, error: "This job isn't booked." };
    const admin = createSupabaseAdminClient();
    const { count } = await admin.from("crm_emails").select("id", { count: "exact", head: true }).eq("estimate_id", estimateId);
    const to = count ? "quoted" : "draft";
    await admin.from("estimates").update({ status: to, booked_at: null }).eq("id", estimateId);
    await admin.from("quotes").update({ booked_at: null }).eq("estimate_id", estimateId);
    await logStatus(estimateId, "release_book", "booked", to, staff);
    return { ok: true };
  } catch (e) { return fail(e); }
}

/** CANCEL LEAD: kept in the database, hidden everywhere except Search (marked CANCELLED). */
export async function cancelJob(estimateId: string): Promise<Result> {
  try {
    const staff = await requireStaff();
    const row = await getAccessibleEstimate(staff, estimateId);
    if (!row) return { ok: false, error: "Estimate not found." };
    if (row.status === "cancelled") return { ok: true };
    await createSupabaseAdminClient().from("estimates").update({ status: "cancelled", booked_at: null }).eq("id", estimateId);
    await logStatus(estimateId, "cancelled", row.status, "cancelled", staff);
    return { ok: true };
  } catch (e) { return fail(e); }
}

/** Reopen a cancelled lead (back to follow-up). */
export async function reopenJob(estimateId: string): Promise<Result> {
  try {
    const staff = await requireStaff();
    const row = await getAccessibleEstimate(staff, estimateId);
    if (!row) return { ok: false, error: "Estimate not found." };
    if (row.status !== "cancelled") return { ok: false, error: "Only a cancelled lead can be reopened." };
    await createSupabaseAdminClient().from("estimates").update({ status: "draft" }).eq("id", estimateId);
    await logStatus(estimateId, "reopened", "cancelled", "draft", staff);
    return { ok: true };
  } catch (e) { return fail(e); }
}

/**
 * DELETE LEAD (admin only): PERMANENT. The append-only history can only be removed through
 * the security-definer DB function crm_delete_lead(), which re-checks the admin, requires the
 * typed job number, and leaves a minimal audit row (job number, who, when).
 */
export async function deleteJob(estimateId: string, confirmJobNumber: string): Promise<Result> {
  try {
    const staff = await requireStaff();
    if (staff.role !== "admin") return { ok: false, error: "Only an admin can delete a lead." };
    const { error } = await createSupabaseAdminClient().rpc("crm_delete_lead", {
      p_estimate_id: estimateId, p_actor: staff.userId, p_confirm_job_number: normalizeJobNumber(confirmJobNumber) || String(confirmJobNumber || ""),
    });
    if (error) return { ok: false, error: /job number/i.test(error.message) ? "Type the job number exactly to confirm." : error.message || "Could not delete the lead." };
    return { ok: true };
  } catch (e) { return fail(e); }
}

/**
 * Assign New Estimates portal (admin only): unassigned leads split into Web Leads (website
 * intake, source "Web Lead") and Bought Leads (source "Purchased Lead"); anything else that was
 * sent to the pool by hand is listed under "Other unassigned". Oldest job number first.
 */
export async function listUnassigned() {
  try {
    const staff = await requireStaff();
    if (staff.role !== "admin") return { ok: false as const, error: "Assign New Estimates is for admins." };
    const admin = createSupabaseAdminClient();
    const base = "id, job_number, customer_name, pickup_address, delivery_address, created_at, lead_source, priority";
    type UnassignedRow = {
      id: string; job_number: string | null; customer_name: string | null;
      pickup_address: string | null; delivery_address: string | null;
      created_at: string; lead_source: string | null; priority: number | null; intake_notice_error?: string | null;
    };
    const withNotice = await admin.from("estimates").select(`${base}, intake_notice_error`).eq("status", "unassigned").is("deleted_at", null).limit(1000);
    let data = (withNotice.data || []) as UnassignedRow[];
    if (withNotice.error) {
      if (!/intake_notice_error/i.test(withNotice.error.message)) throw new Error(withNotice.error.message);
      const second = await admin.from("estimates").select(base).eq("status", "unassigned").is("deleted_at", null).limit(1000);
      if (second.error) throw new Error(second.error.message);
      data = (second.data || []) as UnassignedRow[];
    }
    const ids = data.map(e => e.id);
    const { data: veh } = ids.length ? await admin.from("vehicles").select("estimate_id, year, make, model").in("estimate_id", ids) : { data: [] as { estimate_id: string; year: number | null; make: string | null; model: string | null }[] };
    const vMap = new Map<string, string[]>();
    for (const v of veh || []) vMap.set(v.estimate_id, [...(vMap.get(v.estimate_id) || []), [v.year, v.make, v.model].filter(Boolean).join(" ")]);
    const leads = data
      .map(e => ({ ...e, intake_notice_error: e.intake_notice_error || null, vehicles: (vMap.get(e.id) || []).join(", "), panel: assignPanelFor(e.lead_source) }))
      .sort((x, y) => String(x.job_number || "").localeCompare(String(y.job_number || ""), undefined, { numeric: true }));
    const [{ data: reps }, priorities] = await Promise.all([
      admin.from("crm_reps").select("id, name, user_id").eq("is_active", true).not("user_id", "is", null).order("sort_order").order("name"),
      loadPriorityLabels(),
    ]);
    return { ok: true as const, leads, reps: reps || [], priorities };
  } catch (e) { return fail(e); }
}

/** Change User: an administrator gives the lead to one rep. The previous rep no longer owns it. */
export async function changeLeadUser(estimateId: string, repId: string): Promise<Result> {
  try {
    const staff = await requireStaff();
    if (staff.role !== "admin") return { ok: false, error: "Only an administrator can change the user." };
    const rep = await repById(repId);
    if (!rep?.is_active || !rep.user_id) return { ok: false, error: "Pick an active representative." };
    const admin = createSupabaseAdminClient();
    const { data: current } = await admin.from("estimates")
      .select("id, status, owner_id, job_number, customer_name")
      .eq("id", estimateId).is("deleted_at", null).maybeSingle();
    if (!current) return { ok: false, error: "Estimate not found." };
    const patch = oneRepPatch({ id: rep.id, userId: rep.user_id }, current.status);
    const { error } = await admin.from("estimates").update(patch).eq("id", estimateId);
    if (error) return { ok: false, error: "The user could not be changed." };
    if (rep.user_id !== staff.userId && rep.user_id !== current.owner_id) {
      await notifyUser("new_lead", `New lead for ${rep.name}: ${jobLabel(current)}`, { id: current.id }, rep.user_id);
    }
    return { ok: true };
  } catch (e) { return fail(e); }
}

export async function assignLead(estimateId: string, repId: string): Promise<Result> {
  try {
    const staff = await requireStaff();
    if (staff.role !== "admin") return { ok: false, error: "Assign New Estimates is for admins." };
    const rep = await repById(repId);
    if (!rep || !rep.user_id) return { ok: false, error: "Pick an active representative." };
    const admin = createSupabaseAdminClient();
    const { data: est } = await admin.from("estimates").update({ assigned_rep_id: rep.id, owner_id: rep.user_id, status: "draft" })
      .eq("id", estimateId).eq("status", "unassigned").select("id, job_number, customer_name, lead_source").maybeSingle();
    if (!est) return { ok: false, error: "That lead was already assigned." };
    // Audit: append-only status log ('assigned' needs migration 20261023210000); until that is
    // applied, the same line goes to the lead's Operations notes (also append-only).
    const panel = assignPanelFor(est.lead_source);
    const where = panel === "web" ? "Web Leads" : panel === "bought" ? "Bought Leads" : "Other unassigned";
    const { error: logErr } = await admin.from("estimate_status_log").insert({ estimate_id: est.id, action: "assigned", from_status: "unassigned", to_status: `draft · ${rep.name}`, actor: staff.userId, actor_name: staff.name });
    if (logErr) await admin.from("estimate_notes").insert({ estimate_id: est.id, kind: "operations", created_by: staff.userId, author_name: staff.name, body: `Assigned to ${rep.name} by ${staff.name} (Assign New Estimates · ${where}).` });
    // New Lead banner: ONLY the rep who got the lead (not the assigner, not other admins).
    if (rep.user_id !== staff.userId) await notifyUser("new_lead", `New lead for ${rep.name}: ${jobLabel(est)}`, { id: est.id }, rep.user_id);
    return { ok: true };
  } catch (e) { return fail(e); }
}

/**
 * Main-menu search. Name: 3+ letters matching the start of the first or last name.
 * Phone: digits only (last 10), so any formatting or a leading 1 matches. Also email and
 * job number with or without "FB".
 */
export async function searchLeads(query: string) {
  try {
    const staff = await requireStaff();
    const q = String(query || "").trim().slice(0, 80);
    if (q.length < 3) return { ok: true as const, results: [] };
    const admin = createSupabaseAdminClient();
    const safe = q.replace(/[%,()*\\]/g, " ").trim();
    const d = digits(q);
    const ors: string[] = [];
    // Job number: "FB400001" or "400001" (any length, so FB1000000+ works too).
    const job = normalizeJobNumber(q);
    if (job) ors.push(`job_number.eq.${job}`);
    if (d.length >= 4 && /^[\d\s().+-]+$/.test(q)) ors.push(`phone_search.ilike.*${d.length === 11 && d.startsWith("1") ? d.slice(1) : d.slice(-10)}*`);
    if (/[a-z]/i.test(safe)) {
      const v = safe.replace(/"/g, "");
      ors.push(`customer_name.ilike."${v}*"`, `customer_name.ilike."* ${v}*"`);
      ors.push(`customer_email.ilike."*${v}*"`);
    }
    if (!ors.length) return { ok: true as const, results: [] };
    let req = admin.from("estimates")
      .select("id, job_number, customer_name, customer_phone, customer_email, status, priority, primary_date, miles, miles_source")
      .is("deleted_at", null).or(ors.join(",")).order("created_at", { ascending: false }).limit(25);
    if (!isManager(staff)) req = req.eq("owner_id", staff.userId);
    const { data, error } = await req;
    if (error) throw new Error(error.message);
    const ids = (data || []).map(r => r.id);
    const signed = ids.length ? await signedFlags(ids) : {};
    return { ok: true as const, results: (data || []).map(r => ({ ...r, ...(signed[r.id] || { quoteSigned: false, ccSigned: false }) })) };
  } catch (e) { return fail(e); }
}

/** For lists: which jobs have a signed contract ($) / signed CC form (CC). */
export async function signedFlags(estimateIds: string[]): Promise<Record<string, { quoteSigned: boolean; ccSigned: boolean }>> {
  const admin = createSupabaseAdminClient();
  const { data: events } = await admin.from("crm_email_events").select("estimate_id, email_id").eq("event", "signed").in("estimate_id", estimateIds);
  if (!events?.length) return {};
  const { data: emails } = await admin.from("crm_emails").select("id, kind").in("id", events.map(e => e.email_id));
  const kind = new Map((emails || []).map(e => [e.id, e.kind]));
  const out: Record<string, { quoteSigned: boolean; ccSigned: boolean }> = {};
  for (const e of events) {
    const f = (out[e.estimate_id] ||= { quoteSigned: false, ccSigned: false });
    if (kind.get(e.email_id) === "booked_esign") f.quoteSigned = true;
    if (kind.get(e.email_id) === "cc_form") f.ccSigned = true;
  }
  return out;
}

/** Estimates In Process list (rep: own; admin/supervisor: all). */
export async function listMyLeads() {
  try {
    const staff = await requireStaff();
    const admin = createSupabaseAdminClient();
    let req = admin.from("estimates")
      .select("id, job_number, customer_name, status, priority, primary_date, follow_up_at, pickup_address, delivery_address, assigned_rep_id, created_at")
      .is("deleted_at", null).neq("status", "cancelled").neq("status", "unassigned").order("created_at", { ascending: false }).limit(200);
    if (!isManager(staff)) req = req.eq("owner_id", staff.userId);
    const { data } = await req;
    const { data: reps } = await admin.from("crm_reps").select("id, name");
    const repName = new Map((reps || []).map(r => [r.id, r.name]));
    const signed = data?.length ? await signedFlags(data.map(r => r.id)) : {};
    return { ok: true as const, leads: (data || []).map(r => ({ ...r, rep: repName.get(r.assigned_rep_id) || "", ...(signed[r.id] || { quoteSigned: false, ccSigned: false }) })) };
  } catch (e) { return fail(e); }
}

/** Operations calendar: booked jobs on their Primary Date (first day of the pickup window). */
export async function calendarJobs(year: number, monthIndex: number) {
  try {
    const staff = await requireStaff();
    const pad = (n: number) => String(n).padStart(2, "0");
    const start = `${year}-${pad(monthIndex + 1)}-01`;
    const next = monthIndex === 11 ? `${year + 1}-01-01` : `${year}-${pad(monthIndex + 2)}-01`;
    const admin = createSupabaseAdminClient();
    let req = admin.from("estimates").select("id, job_number, customer_name, primary_date, miles, miles_source")
      .eq("status", "booked").is("deleted_at", null).gte("primary_date", start).lt("primary_date", next).order("primary_date");
    if (!isManager(staff)) req = req.eq("owner_id", staff.userId);
    const { data } = await req;
    return { ok: true as const, jobs: data || [] };
  } catch (e) { return fail(e); }
}

/** PostgREST filter: the user's own leads OR leads assigned to them as rep. */
async function ownerOrAssigned(admin: ReturnType<typeof createSupabaseAdminClient>, userId: string) {
  const { data: mine } = await admin.from("crm_reps").select("id").eq("user_id", userId);
  const ids = (mine || []).map(r => r.id);
  return ids.length ? `owner_id.eq.${userId},assigned_rep_id.in.(${ids.join(",")})` : `owner_id.eq.${userId}`;
}

/**
 * Follow Up menu: in-process leads (not booked, not cancelled, not unassigned).
 * Booked jobs leave every group and live on the calendar. Priority labels are the company's list.
 */
export async function followUpGroups() {
  try {
    const staff = await requireStaff();
    const admin = createSupabaseAdminClient();
    let q = admin.from("estimates")
      .select("id, job_number, customer_name, priority, follow_up_at, last_touched_at, primary_date, assigned_rep_id, created_at")
      .is("deleted_at", null).in("status", ["draft", "quoted", "signed"]).order("follow_up_at", { ascending: true, nullsFirst: false }).limit(1000);
    if (!isManager(staff)) q = q.or(await ownerOrAssigned(admin, staff.userId));
    const [{ data }, { data: reps }, labels] = await Promise.all([
      q, admin.from("crm_reps").select("id, name"),
      loadPriorityLabels(),
    ]);
    const repName = new Map((reps || []).map(r => [r.id, r.name]));
    const leads = (data || []).map(l => ({ ...l, rep: repName.get(l.assigned_rep_id) || "" }));
    return {
      ok: true as const,
      labels,
      leads,
    };
  } catch (e) { return fail(e); }
}

/** "Recalculate" link next to Miles: recompute from the ZIPs (clears a manual override). */
export async function recalcMiles(estimateId: string): Promise<Result> {
  try {
    const staff = await requireStaff();
    const row = await getAccessibleEstimate(staff, estimateId);
    if (!row) return { ok: false, error: "Estimate not found." };
    const admin = createSupabaseAdminClient();
    const { data: e } = await admin.from("estimates").select("pickup_zip, delivery_zip").eq("id", estimateId).maybeSingle();
    const m = await milesForZips(e?.pickup_zip, e?.delivery_zip);
    if (!m) return { ok: false, error: "Couldn't locate one of the ZIP codes." };
    await admin.from("estimates").update(m).eq("id", estimateId);
    return { ok: true };
  } catch (e) { return fail(e); }
}

