"use client";

// F.A.D. (First Available Delivery) + Delivery date the carrier gives (Owner 2026-10-31).
// Each is a two-day window (first + second date; second optional). Back office only: not on the customer print.
import { useEffect, useState } from "react";
import DatePopup from "@/app/components/DatePopup";
import { saveDeliveryWindows, type DeliveryWindows } from "@/app/actions/carrier-owes";

const s = (v: unknown) => (v ? String(v).slice(0, 10) : "");
export default function DeliveryWindowsBox({ est, onSaved }: { est: { id: string } & Partial<Record<keyof DeliveryWindows, string | null>>; onSaved: () => void }) {
  const saved: DeliveryWindows = { fad_start: s(est.fad_start), fad_end: s(est.fad_end), delivery_window_start: s(est.delivery_window_start), delivery_window_end: s(est.delivery_window_end) };
  const key = JSON.stringify(saved);
  const [w, setW] = useState(saved);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  useEffect(() => setW(JSON.parse(key)), [key]);
  const dirty = JSON.stringify(w) !== key;
  const set = (p: Partial<DeliveryWindows>) => { setW(x => ({ ...x, ...p })); setMsg(null); };
  const save = async () => {
    setBusy(true);
    const r = await saveDeliveryWindows(est.id, w);
    setBusy(false);
    if (!r.ok) return setMsg({ text: r.error, error: true });
    setMsg({ text: "Delivery dates saved." }); onSaved();
  };
  const pair = (label: string, title: string, a: keyof DeliveryWindows, b: keyof DeliveryWindows, id: string) => (
    <div className="chp-row" data-testid={`${id}-window`}><span title={title}>{label}</span>
      <span className="chp-pair">
        <DatePopup value={w[a]} onChange={v => set({ [a]: v } as Partial<DeliveryWindows>)} label={`${title} first day`} testId={`${id}-start`} />
        <DatePopup value={w[b]} onChange={v => set({ [b]: v } as Partial<DeliveryWindows>)} label={`${title} second day (optional)`} testId={`${id}-end`} />
      </span>
    </div>
  );
  return (
    <div data-testid="delivery-windows" style={{ marginTop: 6 }}>
      {pair("F.A.D.", "First Available Delivery", "fad_start", "fad_end", "fad")}
      {pair("Delivery date", "Delivery date (from the carrier)", "delivery_window_start", "delivery_window_end", "delivery-date")}
      <small className="muted">2nd day optional; one day is fine.</small>
      {(dirty || msg) && <div className="chp-row">
        {dirty && <button type="button" className="btn btn-sm" onClick={save} disabled={busy} data-testid="delivery-windows-save">Save dates</button>}
        {msg && <small className={msg.error ? "soft-warn" : "muted"} role="status">{msg.text}</small>}
      </div>}
    </div>
  );
}
