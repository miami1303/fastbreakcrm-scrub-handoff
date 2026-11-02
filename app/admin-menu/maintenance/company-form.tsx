"use client";

import { useEffect, useState } from "react";
import { getCompanySettings, saveCompanySettings } from "@/app/actions/settings";
import { COMPANY_SETTING_LABELS, type CompanyInfo } from "@/lib/templates/company";

const FIELDS: (keyof CompanyInfo)[] = ["mainPhone", "companyEmail", "website", "address", "quoteCompanyName", "ccCompanyName", "emailFromName", "usDot", "iccMc", "emailSendAs"];

export default function CompanyForm() {
  const [v, setV] = useState<CompanyInfo | null>(null);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const [saving, setSaving] = useState(false);
  const [policyMode, setPolicyMode] = useState<"quote" | "booked">("quote");
  const [policyMsg, setPolicyMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const [policySaving, setPolicySaving] = useState(false);

  useEffect(() => { getCompanySettings().then(r => (r.ok ? setV(r.company) : setMsg({ text: r.error, error: true }))); }, []);
  if (!v) return <div className="card">{msg ? <p className="status-msg error">{msg.text}</p> : "Loading…"}</div>;

  const policyKey = policyMode === "quote" ? "policyQuote" : "policyBooked";
  const policyLabel = policyMode === "quote" ? "Quote" : "Booked Job";

  return (
    <>
      <form className="card" onSubmit={async e => {
        e.preventDefault(); setSaving(true);
        const r = await saveCompanySettings(v);
        setSaving(false);
        setMsg(r.ok ? { text: "Saved. New quotes, CC forms and emails use these right away." } : { text: r.error, error: true });
      }}>
        <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>Shown on every customer document and email (quote, booked quote, CC authorization form) and in the CRM header. Each user&apos;s own phone and email are edited under Users.</p>
        <div className="grid-2">
          {FIELDS.map(f => (
            <label key={f} className="field">{COMPANY_SETTING_LABELS[f]}
              {f === "emailSendAs"
                ? <select value={v[f] === "rep" ? "rep" : "company"} onChange={e => setV({ ...v, [f]: e.target.value })} data-testid="company-emailSendAs">
                    <option value="company">Company email (From {v.companyEmail}; replies go to the rep)</option>
                    <option value="rep">The lead rep&apos;s own email (when on an allowed domain)</option>
                  </select>
                : <input value={v[f]} onChange={e => setV({ ...v, [f]: e.target.value })} data-testid={`company-${f}`} maxLength={200} />}
            </label>
          ))}
        </div>
        {msg && <p className={`status-msg${msg.error ? " error" : ""}`} role="status">{msg.text}</p>}
        <div className="btn-row"><button type="submit" className="btn btn-primary" disabled={saving} data-testid="company-save">{saving ? "Saving…" : "Save Company Settings"}</button></div>
      </form>

      <div className="card" style={{ marginTop: 16 }} data-testid="company-policy">
        <h3 style={{ margin: "0 0 8px 0" }}>Company Policy</h3>
        <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>Terms and conditions shown on customer documents. Toggle between Quote and Booked Job. Leave blank to use the built-in default terms. Per-lead notes still append under this.</p>
        <div className="btn-row" style={{ marginBottom: 10 }}>
          <button type="button" className={`btn btn-sm${policyMode === "quote" ? " btn-primary" : ""}`} onClick={() => setPolicyMode("quote")} data-testid="policy-toggle-quote">Quote</button>
          <button type="button" className={`btn btn-sm${policyMode === "booked" ? " btn-primary" : ""}`} onClick={() => setPolicyMode("booked")} data-testid="policy-toggle-booked">Booked Job</button>
        </div>
        <label className="field" style={{ display: "block" }}>
          Company Policy ({policyLabel})
          <textarea
            value={v[policyKey] || ""}
            onChange={e => setV({ ...v, [policyKey]: e.target.value })}
            rows={12}
            style={{ width: "100%", fontFamily: "inherit", fontSize: 13, lineHeight: 1.4 }}
            data-testid={`company-${policyKey}`}
            placeholder={policyMode === "quote" ? "Shorter terms for quotes (optional)" : "Full terms for booked jobs"}
          />
        </label>
        {policyMsg && <p className={`status-msg${policyMsg.error ? " error" : ""}`} role="status">{policyMsg.text}</p>}
        <div className="btn-row">
          <button type="button" className="btn btn-primary" disabled={policySaving} data-testid="company-policy-save" onClick={async () => {
            setPolicySaving(true);
            const r = await saveCompanySettings({ [policyKey]: v[policyKey] || "" });
            setPolicySaving(false);
            setPolicyMsg(r.ok ? { text: `Saved ${policyLabel} policy.` } : { text: r.error, error: true });
          }}>{policySaving ? "Saving…" : `Save ${policyLabel} Policy`}</button>
        </div>
      </div>
    </>
  );
}
