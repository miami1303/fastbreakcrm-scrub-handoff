/**
 * Pure checks for the public website quote form.
 * Saving and emailing live in the API route so a mail failure cannot roll back the lead.
 */

export const CRM_PHONE_DISPLAY = "555-010-0100";
export const INTAKE_NOTICE_TO = process.env.WEBSITE_LEAD_NOTICE_TO || "support@fastbreakcrm.test";

const PUBLIC_HOSTS = new Set(["fastbreakcrm.test", "fastbreakcrm.test"]);

export type IntakeVehicle = {
  year: number | null;
  make: string;
  model: string;
  type: string;
  runs: boolean;
  closed: boolean;
};

export type WebsiteLead = {
  name: string;
  email: string;
  phone1: string;
  phone2: string;
  fromZip: string;
  toZip: string;
  transportDate: string | null;
  vehicles: IntakeVehicle[];
};

export type IntakeParseResult =
  | { ok: true; spam: true }
  | { ok: true; spam: false; lead: WebsiteLead }
  | { ok: false; errors: string[] };

const TYPE_ALIASES: Record<string, string> = {
  boats: "Boat",
  boat: "Boat",
  "heavy equ.": "Heavy Equipment",
  "heavy equ": "Heavy Equipment",
  "heavy equipment": "Heavy Equipment",
};

export function isAllowedIntakeOrigin(origin: string | null, crmOrigins: string[]): boolean {
  if (!origin) return false;
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  const host = parsed.hostname.toLowerCase();
  if (PUBLIC_HOSTS.has(host)) return parsed.protocol === "https:" || parsed.protocol === "http:";
  return crmOrigins.some((candidate) => {
    try {
      return new URL(candidate).origin === parsed.origin;
    } catch {
      return false;
    }
  });
}

export function originFromReferer(referer: string | null): string | null {
  if (!referer) return null;
  try {
    return new URL(referer).origin;
  } catch {
    return null;
  }
}

export function clientIpFromHeaders(headers: { get(name: string): string | null }): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first.slice(0, 64);
  }
  const real = headers.get("x-real-ip")?.trim();
  if (real) return real.slice(0, 64);
  return "unknown";
}

export function parseWebsiteLead(input: unknown): IntakeParseResult {
  const fields = flattenIntake(input);
  if (honeypotFilled(fields)) return { ok: true, spam: true };

  const errors: string[] = [];
  const name = clean(first(fields, ["name", "full_name", "fullname", "your_name", "sname", "customer_name"]), 120);
  const email = clean(first(fields, ["email", "email_address", "your_email", "customer_email"]), 254).toLowerCase();
  const phone1 = clean(first(fields, ["phone", "phone1", "phone_number", "telephone", "tel", "stelh", "customer_phone"]), 30);
  const phone2 = clean(first(fields, ["phone2", "stelo"]), 30);
  const fromZip = normalizeZip(first(fields, ["from_zip", "fromzip", "szip", "pickup_zip", "pickup_zip_code", "pickup", "origin_zip"]));
  const toZip = normalizeZip(first(fields, ["to_zip", "tozip", "rzip", "delivery_zip", "delivery_zip_code", "delivery", "destination_zip"]));
  const dateRaw = first(fields, ["transport_date", "transportdate", "movedate", "move_date"]);
  const transportDate = dateRaw ? normalizeTransportDate(dateRaw) : null;

  if (name.length < 2) errors.push("Enter the customer name.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push("Enter a valid email address.");
  if (!phone1 && !phone2) errors.push("Enter a phone number.");
  if (phone1 && digits(phone1).length < 10) errors.push("The first phone number needs an area code.");
  if (phone2 && digits(phone2).length < 10) errors.push("The second phone number needs an area code.");
  if (!fromZip) errors.push("Enter the pickup ZIP code (5 digits).");
  if (!toZip) errors.push("Enter the delivery ZIP code (5 digits).");
  if (dateRaw && !transportDate) errors.push("The transport date should look like MM/DD/YYYY.");

  const vehicles = readVehicles(input, fields, errors);
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    spam: false,
    lead: {
      name,
      email,
      phone1,
      phone2,
      fromZip: fromZip || "",
      toZip: toZip || "",
      transportDate,
      vehicles,
    },
  };
}

export function noticeErrorFromSend(result: { ok: boolean } | null): string | null {
  if (result == null) return "The email notice did not send because the email service is not set up yet.";
  if (!result.ok) return "The email notice did not send. The lead is saved.";
  return null;
}

export function buildIntakeNotice(lead: WebsiteLead, jobNumber: string, phone = CRM_PHONE_DISPLAY, leadUrl = ""): { subject: string; text: string } {
  const lines = [
    "New Web Lead from the Fast Break website Get a Quote form.",
    "It is waiting in Assign New Estimate.",
    "",
    `Job number: ${jobNumber || "(not assigned yet)"}`,
    `Open lead: ${leadUrl || "(open Assign New Estimate in the CRM)"}`,
    "",
    `Office phone: ${phone}`,
    "",
    `Name: ${lead.name}`,
    `Email: ${lead.email}`,
    `Phone: ${lead.phone1 || "(none)"}`,
    `Second phone: ${lead.phone2 || "(none)"}`,
    `From ZIP: ${lead.fromZip}`,
    `To ZIP: ${lead.toZip}`,
    `Transport date: ${lead.transportDate || "(not given)"}`,
    "",
    "Vehicles:",
  ];
  if (lead.vehicles.length === 0) lines.push("(none listed)");
  lead.vehicles.forEach((vehicle, index) => {
    lines.push(
      `Vehicle ${index + 1}`,
      `  Year: ${vehicle.year ?? "(not given)"}`,
      `  Make: ${vehicle.make || "(not given)"}`,
      `  Model: ${vehicle.model || "(not given)"}`,
      `  Type: ${vehicle.type || "(not given)"}`,
      `  Runs: ${vehicle.runs ? "Yes" : "No"}`,
      `  Closed trailer: ${vehicle.closed ? "Yes" : "No"}`,
    );
  });
  const text = lines.join("\n");
  return { subject: `New Web Lead - ${lead.name}`, text };
}

/** Plain HTML for the office notice. logoPath must be the CRM logo path so the mailer can inline it. */
export function intakeNoticeHtml(text: string, logoPath: string): string {
  return `<div style="font-family:Georgia,serif;color:#172033;font-size:15px;line-height:1.45"><img src="${escapeHtml(logoPath)}" alt="Fastbreak CRM" width="180"><p>${escapeHtml(text).replaceAll("\n", "<br>")}</p></div>`;
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    if (character === "&") return "&amp;";
    if (character === "<") return "&lt;";
    if (character === ">") return "&gt;";
    if (character === '"') return "&quot;";
    return "&#39;";
  });
}

function readVehicles(input: unknown, fields: Map<string, string>, errors: string[]): IntakeVehicle[] {
  const fromArray = arrayVehicles(input);
  let vehicles = fromArray.length ? fromArray : [1, 2].map((index) => vehicleFromFields(fields, index));
  if (!vehicles.some(vehicleHasDetail)) {
    // your mail host Contact form 18 uses one textarea for "vehicle year / make / model".
    const free = first(fields, ["vehicle", "vehicles", "vehicle_info", "year_make_model", "message"]);
    if (free) vehicles = parseFreeTextVehicles(free);
  }
  const filled = vehicles.filter(vehicleHasDetail);
  if (filled.length > 2) {
    errors.push("A website quote can include up to two vehicles.");
    return filled.slice(0, 2);
  }
  return filled;
}

/** "2020 Toyota Camry" per line (or ";" separated). Year optional; first word after year = make. */
export function parseFreeTextVehicles(text: string): IntakeVehicle[] {
  return text.split(/[\n;]+/).map((line) => clean(line, 160)).filter(Boolean).slice(0, 3).map((line) => {
    const words = line.replace(/[,/]+/g, " ").split(/\s+/).filter(Boolean);
    let year: number | null = null;
    if (words[0] && /^\d{4}$/.test(words[0])) year = parseYear(words.shift() as string);
    const make = clean(words.shift() || "", 60);
    const model = clean(words.join(" "), 60);
    return { year, make, model, type: "", runs: true, closed: false };
  });
}

function arrayVehicles(input: unknown): IntakeVehicle[] {
  if (!input || typeof input !== "object" || !("vehicles" in input)) return [];
  const vehicles = (input as { vehicles?: unknown }).vehicles;
  if (!Array.isArray(vehicles)) return [];
  return vehicles.map((entry) => {
    const record = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : {};
    return {
      year: parseYear(valueOf(record.year)),
      make: clean(valueOf(record.make), 60),
      model: clean(valueOf(record.model), 60),
      type: normalizeType(clean(valueOf(record.type ?? record.vehicle_type), 40)),
      runs: parseRuns(record.runs ?? record.run ?? record.running),
      closed: parseClosed(record.closed ?? record.closed_trailer ?? record.cover ?? record.enclosed),
    };
  });
}

function vehicleFromFields(fields: Map<string, string>, index: number): IntakeVehicle {
  const present = (names: string[]) => names.some((name) => fields.has(name));
  const runsNames = [`runs${index}`, `run${index}`];
  const closedNames = [`closed${index}`, `closed_trailer${index}`, `cover${index}`];
  return {
    year: parseYear(first(fields, [`year${index}`])),
    make: clean(first(fields, [`make${index}`]), 60),
    model: clean(first(fields, [`model${index}`]), 60),
    type: normalizeType(clean(first(fields, [`type${index}`]), 40)),
    runs: present(runsNames) ? parseRuns(first(fields, runsNames)) : true,
    closed: present(closedNames) ? parseClosed(first(fields, closedNames)) : false,
  };
}

function vehicleHasDetail(vehicle: IntakeVehicle): boolean {
  return Boolean(vehicle.year || vehicle.make || vehicle.model || vehicle.type);
}

function parseYear(value: string): number | null {
  if (!value) return null;
  if (!/^\d{4}$/.test(value)) return null;
  const year = Number(value);
  if (year < 1900 || year > 2100) return null;
  return year;
}

function parseRuns(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  const text = valueOf(value).trim().toLowerCase();
  if (!text) return true;
  return !["0", "no", "false", "off", "does not run", "not running", "inop"].includes(text);
}

function parseClosed(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  const text = valueOf(value).trim().toLowerCase();
  if (!text) return false;
  return ["1", "yes", "true", "on", "checked", "closed", "enclosed"].includes(text);
}

function normalizeType(value: string): string {
  if (!value) return "";
  return TYPE_ALIASES[value.toLowerCase()] || value;
}

function normalizeTransportDate(value: string): string | null {
  const trimmed = value.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(trimmed);
  let year: number;
  let month: number;
  let day: number;
  if (iso) {
    year = Number(iso[1]);
    month = Number(iso[2]);
    day = Number(iso[3]);
  } else if (us) {
    month = Number(us[1]);
    day = Number(us[2]);
    year = Number(us[3]);
  } else {
    return null;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  if (year < 2000 || year > 2100) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function normalizeZip(value: string): string | null {
  const onlyDigits = digits(value);
  if (onlyDigits.length === 5 || onlyDigits.length === 9) return onlyDigits.slice(0, 5);
  return null;
}

function digits(value: string): string {
  return value.replace(/\D/g, "");
}

function honeypotFilled(fields: Map<string, string>): boolean {
  return ["company_website", "fax_number"].some((name) => (fields.get(name) || "").trim() !== "");
}

function flattenIntake(input: unknown): Map<string, string> {
  const fields = new Map<string, string>();
  if (!input || typeof input !== "object") return fields;
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      fields.set(key.toLowerCase(), String(value));
    }
  }
  return fields;
}

function first(fields: Map<string, string>, names: string[]): string {
  for (const name of names) {
    const value = fields.get(name.toLowerCase());
    if (value && value.trim()) return value.trim();
  }
  return "";
}

function clean(value: string, max: number): string {
  return value.replace(/[\u0000-\u001F\u007F]/g, "").trim().slice(0, max);
}

function valueOf(value: unknown): string {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}
