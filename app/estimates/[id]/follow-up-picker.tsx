"use client";

import { useState } from "react";
import DatePopup from "@/app/components/DatePopup";
import { chicagoParts, chicagoToIso, crmStamp } from "@/lib/crm-time";

const pad = (n: number) => String(n).padStart(2, "0");

/** Follow Up date (popup calendar) + time. The date + time are Central Time (America/Chicago). */
export default function FollowUpPicker({ value, onSave }: { value: string | null; onSave: (iso: string | null) => void }) {
  const current = value ? chicagoParts(value) : null;
  const [date, setDate] = useState(current ? `${current.y}-${pad(current.m + 1)}-${pad(current.d)}` : "");
  const [time, setTime] = useState(current ? `${pad(current.h)}:${pad(current.mi)}` : "09:00");
  const currentDate = current ? `${current.y}-${pad(current.m + 1)}-${pad(current.d)}` : "";
  const currentTime = current ? `${pad(current.h)}:${pad(current.mi)}` : "";
  const changed = date !== currentDate || (!!date && time !== currentTime);

  // Saves on its own as soon as a date is picked and when the time field is left (Owner's live
  // bug: a picked date was lost when Priority was set / Submit Charges was clicked without "Set").
  function save(d = date, t = time) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
    if (!m) return;
    const [h, mi] = t.split(":").map(Number);
    onSave(chicagoToIso(+m[1], +m[2] - 1, +m[3], h || 0, mi || 0));
  }

  return (
    <div className="fu-picker" data-testid="follow-up-picker">
      <div className="fu-row">
        <DatePopup value={date} onChange={d => { setDate(d); if (d && d !== currentDate) save(d, time); }} label="Follow Up date" testId="follow-up-date" clearable={false} />
        <input type="time" value={time} onChange={e => setTime(e.target.value)} onBlur={() => { if (changed && date) save(); }} aria-label="Follow Up time (CT)" data-testid="follow-up-time" />
      </div>
      <div className="fu-row">
        <button type="button" className="btn btn-sm btn-primary" onClick={() => save()} disabled={!date || !changed} data-testid="set-follow-up">Set</button>
        {value && <button type="button" className="btn btn-sm" onClick={() => { setDate(""); onSave(null); }} data-testid="clear-follow-up">Clear</button>}
        <small className="muted fu-tz">CT</small>
      </div>
      {value && <small className="fu-current" data-testid="follow-up-current">{crmStamp(value)}</small>}
    </div>
  );
}
