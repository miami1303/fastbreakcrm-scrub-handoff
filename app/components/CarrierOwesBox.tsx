"use client";

// Carrier Owes box (Owner 2026-10-31). BACK OFFICE ONLY — never on the customer quote / order / print.
// Amount the carrier owes us at delivery. It does NOT change Deposit, COD, Total or Balance.
// Carrier paid = manual entry: records it and stops the "Carrier owes us money" banner.
import { useEffect, useState } from "react";
import { markCarrierPaid, setCarrierOwes } from "@/app/actions/carrier-owes";
import { carrierOwesState, type CarrierOwesInput } from "@/lib/carrier-owes";
import { formatCents } from "@/lib/money";
import { crmStamp } from "@/lib/crm-time";

export type CarrierOwesEst = CarrierOwesInput & { id: string; carrier_owes_paid_by_name?: string | null; carrier_owes_paid_note?: string | null };

export default function CarrierOwesBox({ est, onSaved, compact = false }: { est: CarrierOwesEst; onSaved: () => void; compact?: boolean }) {
  const s = carrierOwesState(est);
  const saved = s.owesC ? (s.owesC / 100).toFixed(2) : "";
  const [amount, setAmount] = useState(saved);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  useEffect(() => setAmount(saved), [saved]);
  const banners = () => window.dispatchEvent(new Event("crm:refresh-banners"));
  const run = async (fn: () => Promise<{ ok: boolean; error?: string }>, ok: string) => {
    setBusy(true); setMsg(null);
    const r = await fn();
    setBusy(false);
    if (!r.ok) return setMsg({ text: r.error || "Not saved.", error: true });
    setMsg({ text: ok }); setNote(""); banners(); onSaved();
  };
  const status = !s.owesC ? null : s.paid
    ? <span className="co-paid" data-testid="carrier-owes-paid">Paid {crmStamp(est.carrier_owes_paid_at)}{est.carrier_owes_paid_by_name ? ` · ${est.carrier_owes_paid_by_name}` : ""}{est.carrier_owes_paid_note ? ` · ${est.carrier_owes_paid_note}` : ""} · added to deposit bookkeeping (customer balance unchanged)</span>
    : <span className="co-open" data-testid="carrier-owes-open">{s.delivered ? "Delivered — carrier still owes us" : "Owed at delivery"}</span>;

  return (
    <div className={`co-box${compact ? " compact" : ""}${s.outstanding ? " open" : ""}`} data-testid="carrier-owes-box">
      <div className="co-row">
        <span className="ch-label">Carrier owes us</span>
        <input className="amt" value={amount} inputMode="decimal" placeholder="0.00" aria-label="Amount the carrier owes us at delivery"
          onChange={e => setAmount(e.target.value)} disabled={busy} data-testid="carrier-owes-amount" />
        <button type="button" className="btn btn-sm" disabled={busy || amount === saved}
          onClick={() => run(() => setCarrierOwes(est.id, amount), amount.trim() ? "Carrier Owes saved." : "Carrier Owes cleared.")} data-testid="carrier-owes-save">Save</button>
        {status}
      </div>
      {s.owesC > 0 && !s.paid && (
        <div className="co-row">
          <input value={note} maxLength={200} placeholder="Confirmation # / note (optional)" aria-label="Carrier payment note" onChange={e => setNote(e.target.value)} disabled={busy} data-testid="carrier-paid-note" />
          <button type="button" className="btn btn-sm" disabled={busy} onClick={() => run(() => markCarrierPaid(est.id, note), `Carrier paid ${formatCents(s.owesC)}. Banner stopped.`)} data-testid="carrier-paid-btn">Mark carrier paid ({formatCents(s.owesC)})</button>
        </div>
      )}
      {s.paid && !compact && <button type="button" className="btn btn-sm" disabled={busy} onClick={() => run(() => markCarrierPaid(est.id, "", true), "Carrier paid entry undone.")} data-testid="carrier-paid-undo">Undo paid</button>}
      <small className="muted">Back office only. The customer&apos;s Deposit, Balance and Total don&apos;t change.</small>
      {msg && <small className={msg.error ? "soft-warn" : "muted"} role="status" data-testid="carrier-owes-msg">{msg.text}</small>}
    </div>
  );
}
