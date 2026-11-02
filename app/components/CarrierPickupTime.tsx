"use client";
// Carrier pickup time buttons under Carrier Info (Owner 2026-10-31). Saves estimates.pickup_time right
// away; the customer order / emails print it next to the pickup day or window ("... at 10:00 AM").
import { useState } from "react";
import { setPickupTime } from "@/app/actions/ops";
import { formatPickupTime } from "@/lib/quote-template";

const QUICK = ["08:00", "10:00", "12:00", "14:00", "16:00"];

export default function CarrierPickupTime({ estimateId, value, pickupText, onSaved, flash }: {
  estimateId: string; value: string | null | undefined; pickupText: string;
  onSaved: () => void; flash: (t: string, err?: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  const cur = String(value || "");
  const save = async (t: string) => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await setPickupTime(estimateId, t);
      if (!r.ok) return flash(r.error, true);
      flash(t ? `Pickup time set: ${formatPickupTime(t)}.` : "Pickup time cleared.");
      onSaved();
    } finally { setBusy(false); }
  };
  return (
    <div className="carrier-time" data-testid="carrier-pickup-time">
      <div className="ct-head"><b>Pickup time</b><span className="muted" data-testid="carrier-pickup-text">{pickupText || "No pickup date yet"}</span></div>
      <div className="ct-row">
        {QUICK.map(t => (
          <button key={t} type="button" className={`ct-btn${cur === t ? " on" : ""}`} onClick={() => save(cur === t ? "" : t)} disabled={busy} aria-pressed={cur === t} data-testid={`pickup-time-${t}`}>{formatPickupTime(t)}</button>
        ))}
        <input type="time" className="ct-input" value={cur} step={900} onChange={e => e.target.value && save(e.target.value)} disabled={busy} aria-label="Other pickup time" data-testid="pickup-time-input" />
        {cur && <button type="button" className="link-btn small" onClick={() => save("")} disabled={busy} data-testid="pickup-time-clear">Clear</button>}
      </div>
      <small className="muted">Prints on the customer order and the pickup confirmation with the carrier info.</small>
    </div>
  );
}
