"use client";

// NEW estimate = the Entry Form. Saving creates the lead (FB job number) and opens Charges.
import { DEFAULT_LEAD_SOURCES, type LeadSourceOption } from "@/lib/lead-sources";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createEstimate, listReps } from "@/app/actions/leads";
import EntryForm, { emptyAddr, type EntryValue } from "@/app/components/EntryForm";
import LeadTabBar from "@/app/components/LeadTabBar";
import { joinStreet } from "@/app/estimates/[id]/lead-context";

type Rep = { id: string; name: string; user_id: string | null };
const empty = (): EntryValue => ({ customer_name: "", customer_email: "", customer_phone: "", lead_source: "", pickup: emptyAddr(), delivery: emptyAddr(), primary_date: "", backup_date: "", pickup_time: "", vehicles: [] });

export default function NewEstimatePage() {
  const router = useRouter();
  const [value, setValue] = useState<EntryValue>(empty);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [reps, setReps] = useState<Rep[]>([]);
  const [rotation, setRotation] = useState(false);
  const [pickupTime, setPickupTime] = useState(false);
  const [assign, setAssign] = useState("unassigned");
  const [leadSources, setLeadSources] = useState<LeadSourceOption[]>(DEFAULT_LEAD_SOURCES);
  const [tried, setTried] = useState(false);

  useEffect(() => {
    listReps().then(r => {
      if (!r.ok) return;
      setReps(r.reps);
      // Manual entries default to the creator (if they are a rep), not Assign New Estimates.
      if (r.selfRepId) setAssign(`rep:${r.selfRepId}`);
      setRotation(r.rotationEnabled);
      setPickupTime(!!r.pickupTime);
      setLeadSources(r.leadSources);
    });
  }, []);
  const dirty = JSON.stringify(value) !== JSON.stringify(empty());

  async function save(to: "vehicles" | "charges") {
    setTried(true);
    if (!value.lead_source) { setError("Pick a Lead Source."); return; }
    setSaving(true);
    setError("");
    const f = new FormData();
    const put = (k: string, v: string) => f.set(k, v);
    put("customer_name", value.customer_name); put("customer_email", value.customer_email); put("customer_phone", value.customer_phone);
    put("lead_source", value.lead_source); put("primary_date", value.primary_date); put("pickup_time", value.pickup_time);
    for (const side of ["pickup", "delivery"] as const) {
      const a = value[side];
      put(`${side}_address`, joinStreet(a)); put(`${side}_city`, a.city); put(`${side}_state`, a.state); put(`${side}_zip`, a.zip); put(`${side}_contact`, a.contact);
      put(`${side}_phone1`, side === "pickup" ? value.customer_phone : a.phone1); put(`${side}_phone2`, a.phone2); put(`${side}_phone3`, a.phone3);
      put(`${side}_phone1_label`, a.phone1Label); put(`${side}_phone2_label`, a.phone2Label); put(`${side}_phone3_label`, a.phone3Label);
    }
    put("vehicles", "[]");
    put("assign", assign);
    const res = await createEstimate(f);
    if (!res.ok) { setSaving(false); setError(res.error); return; }
    // Entry Form -> Add Vehicle -> Charges.
    router.push(to === "vehicles" ? `/estimates/${res.id}/vehicles?new=1` : `/estimates/${res.id}`);
  }

  return (
    <main className="main-content lead-shell" data-testid="new-estimate">
      <LeadTabBar base={null} dirty={dirty} />
      <section className="lead-card" data-testid="tab-entry">
        <h2 className="lead-card-title">Entry Form · New Estimate</h2>
        <form onSubmit={e => { e.preventDefault(); save("vehicles"); }}>
          <EntryForm value={value} onChange={p => setValue(v => ({ ...v, ...p }))} features={{ pickupTime }} leadSources={leadSources} showErrors={tried}
            vehicles={<div className="ef-vehicles"><h3 className="ef-head">Vehicles</h3><p className="muted small" style={{ margin: 0 }}>Save the Entry Form to add vehicles (Year, Make, Model, Type, Run, Enclosed, Qty, Price).</p></div>}
            right={<>
              <div className="ef-jobno">Job No. <b className="muted">assigned on save</b></div>
              <div className="ef-status">Status: <b>New</b></div>
              <label className="ef-row"><span>Assign to</span>
                <select value={assign} onChange={e => setAssign(e.target.value)} name="assign_select" data-testid="assign-select">
                  {reps.map(r => <option key={r.id} value={`rep:${r.id}`}>{r.name}</option>)}
                  <option value="unassigned">Assign New Estimates (unassigned)</option>
                  {rotation && <option value="rotation">Lead rotation (next rep)</option>}
                </select>
              </label>
            </>} />
          {error && <p className="status-msg error" role="alert">{error}</p>}
          <div className="ef-actions">
            <button type="submit" className="btn btn-primary" disabled={saving} data-testid="entry-save">{saving ? "Saving…" : "Save & Add Vehicle"}</button>
            <button type="button" className="btn" disabled={saving} onClick={() => save("charges")} data-testid="entry-continue">Save & Continue to Charges</button>
          </div>
        </form>
      </section>
    </main>
  );
}
