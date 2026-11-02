// Company contact info used by every customer document and email.
// The live values come from the company_settings table (Admin > Company Settings) and are
// read at render/send time. DEFAULT_COMPANY mirrors the migration seed and is only used when
// the table can't be read (e.g. unit tests, or a DB outage), so documents never render blank.

export type CompanyInfo = {
  mainPhone: string;
  companyEmail: string;
  website: string; // shown as typed; links get https:// added
  address: string;
  /** Company name printed on the quote / booked quote ("Fastbreak CRM"). */
  quoteCompanyName: string;
  /** Legal name printed on the CC authorization form (template B: "FAST BREAK CRM DEMO"). */
  ccCompanyName: string;
  /** Display name for the "From" line of outgoing email. */
  emailFromName: string;
  usDot: string;
  iccMc: string;
  /** "company" (default): emails go out From the company email. "rep": From the lead rep's own
   *  email (Maintenance) when its domain is allowed for sending; Reply-To is always the rep. */
  emailSendAs: string;
  /** Company Policy / Terms shown on quotes (can be shorter). Blank = fall back to built-in terms. */
  policyQuote: string;
  /** Company Policy / Terms shown on booked jobs (full terms). Blank = fall back to built-in terms. */
  policyBooked: string;
};

export const COMPANY_SETTING_KEYS: Record<keyof CompanyInfo, string> = {
  mainPhone: "main_phone",
  companyEmail: "company_email",
  website: "website",
  address: "address",
  quoteCompanyName: "quote_company_name",
  ccCompanyName: "cc_company_name",
  emailFromName: "email_from_name",
  usDot: "us_dot",
  iccMc: "icc_mc",
  emailSendAs: "email_send_as",
  policyQuote: "policy_quote",
  policyBooked: "policy_booked",
};

export const COMPANY_SETTING_LABELS: Record<keyof CompanyInfo, string> = {
  mainPhone: "Main phone",
  companyEmail: "Company email",
  website: "Website",
  address: "Address",
  quoteCompanyName: "Company name on the quote / booked quote",
  ccCompanyName: "Company name on the CC authorization form",
  emailFromName: "Email \"From\" display name",
  usDot: "US DOT #",
  iccMc: "ICC MC #",
  emailSendAs: "Send emails as",
  policyQuote: "Company Policy (Quote)",
  policyBooked: "Company Policy (Booked Job)",
};

export const DEFAULT_COMPANY: CompanyInfo = {
  mainPhone: "555-010-0100",
  companyEmail: "support@fastbreakcrm.test",
  website: "fastbreakcrm.test",
  address: "Demo City, ST",
  quoteCompanyName: "Fastbreak CRM",
  ccCompanyName: "FAST BREAK CRM DEMO",
  emailFromName: "Fastbreak CRM",
  usDot: "",
  iccMc: "",
  emailSendAs: "company",
  policyQuote: "",
  policyBooked: "",
};

/** Merge company_settings rows ({key, value}) over the defaults. */
export function companyFromRows(rows: { key: string; value: unknown }[] | null | undefined): CompanyInfo {
  const out: CompanyInfo = { ...DEFAULT_COMPANY };
  for (const [field, key] of Object.entries(COMPANY_SETTING_KEYS) as [keyof CompanyInfo, string][]) {
    const v = rows?.find(r => r.key === key)?.value;
    if (typeof v === "string" && v.trim()) out[field] = v.trim();
  }
  return out;
}

export const websiteHref = (w: string) => (/^https?:\/\//i.test(w) ? w : `https://${w.replace(/^\/+/, "")}`);
export const websiteLabel = (w: string) => w.replace(/^https?:\/\//i, "").replace(/\/$/, "");
