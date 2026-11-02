"use client";

import { useEffect, useRef, useState } from "react";
import { addMonths, monthGrid, monthLabel, parseYmd, todayChicago, type YM } from "@/lib/calendar";
import { crmDate } from "@/lib/crm-time";

/**
 * Small date box. Clicking it opens a two-month calendar (this month + next, arrows without a
 * limit, today highlighted); picking a day fills the box and closes it. Value is "YYYY-MM-DD"
 * (a calendar date: no time zone shift on save); "today" is America/Chicago. Calendar math is
 * the shared lib/calendar.ts module, the same one the Operations Calendar uses.
 */
export default function DatePopup({ value, onChange, name, testId, label, clearable = true, placeholder = "MM/DD/YYYY", disabled }: {
  value: string; onChange: (v: string) => void; name?: string; testId?: string; label?: string; clearable?: boolean; placeholder?: string; disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);
  const today = todayChicago();
  const start = (): YM => { const p = parseYmd(value) || parseYmd(today)!; return { y: p.y, m: p.m }; };
  const [view, setView] = useState<YM>(start);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);

  function toggle() {
    if (disabled) return;
    if (!open) setView(start());
    setOpen(o => !o);
  }

  const month = (ym: YM) => (
    <div className="dp-month" key={`${ym.y}-${ym.m}`} data-month={`${ym.y}-${String(ym.m + 1).padStart(2, "0")}`}>
      <div className="dp-title">{monthLabel(ym)}</div>
      <div className="dp-grid">
        {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map(d => <span key={d} className="dp-dow">{d}</span>)}
        {monthGrid(ym).flat().map(c => c.inMonth
          ? <button key={c.ymd} type="button" data-date={c.ymd} className={`dp-day${c.ymd === value ? " sel" : ""}${c.ymd === today ? " today" : ""}`}
              onClick={() => { onChange(c.ymd); setOpen(false); }}>{c.d}</button>
          : <span key={c.ymd} className="dp-out" />)}
      </div>
    </div>
  );

  return (
    <span className="dp-wrap" ref={wrap}>
      <input type="text" readOnly className="dp-input" value={crmDate(value)} placeholder={placeholder} aria-label={label} aria-haspopup="dialog"
        onClick={toggle} onKeyDown={e => { if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") { e.preventDefault(); toggle(); } }}
        disabled={disabled} data-testid={testId} data-value={value || ""} />
      {name && <input type="hidden" name={name} value={value || ""} />}
      {clearable && value && !disabled && <button type="button" className="dp-clear" aria-label={`Clear ${label || "date"}`} onClick={() => onChange("")}>×</button>}
      {open && (
        <div className="dp-pop" role="dialog" aria-label={label || "Pick a date"} data-testid="date-popup">
          <div className="dp-head">
            <button type="button" className="dp-arrow" aria-label="Previous month" onClick={() => setView(v => addMonths(v, -1))} data-testid="dp-prev">‹</button>
            <button type="button" className="dp-today" onClick={() => { const p = parseYmd(today)!; setView({ y: p.y, m: p.m }); }}>Today</button>
            <button type="button" className="dp-arrow" aria-label="Next month" onClick={() => setView(v => addMonths(v, 1))} data-testid="dp-next">›</button>
          </div>
          <div className="dp-months">{month(view)}{month(addMonths(view, 1))}</div>
        </div>
      )}
    </span>
  );
}
