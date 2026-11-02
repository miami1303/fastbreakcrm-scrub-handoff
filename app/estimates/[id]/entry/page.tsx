"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import EntryForm from "@/app/components/EntryForm";
import VehicleList from "@/app/components/VehicleList";
import { statusLabel } from "@/lib/lead-status";
import { useLead } from "../lead-context";

export default function EntryTab() {
  const { lead, form, set, saveCharges, busy, id, flash, totalCents } = useLead();
  const [tried, setTried] = useState(false);
  const router = useRouter();
  const e = lead.est;

  async function save(next: boolean) {
    setTried(true);
    if (!form.lead_source) return flash("Pick a Lead Source.", true);
    const ok = await saveCharges();
    if (ok && next) router.push(`/estimates/${id}`);
  }

  return (
    <section className="lead-card" data-testid="tab-entry">
      <h2 className="lead-card-title">Entry Form</h2>
      <form onSubmit={x => { x.preventDefault(); save(false); }}>
        <EntryForm value={form} onChange={set} features={{ pickupTime: lead.features.pickupTime }} leadSources={lead.leadSources} showErrors={tried}
          vehicles={<div className="ef-vehicles"><h3 className="ef-head">Vehicles</h3><VehicleList leadId={id} vehicles={form.vehicles} showPrices={lead.features.vehicleExtras} totalCents={totalCents} /></div>}
          right={<>
            <div className="ef-jobno">Job No. <b data-testid="entry-job-number">{e.job_number}</b></div>
            <div className="ef-status">Status: <b className={e.status === "booked" ? "booked" : ""}>{statusLabel(e.status)}</b></div>
            <small className="muted">Rep: {lead.rep?.name || "Unassigned"}</small>
          </>} />
        <div className="ef-actions">
          <button type="submit" className="btn" disabled={busy} data-testid="entry-save">Save</button>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => save(true)} data-testid="entry-continue">Continue to Charges</button>
        </div>
      </form>
    </section>
  );
}
