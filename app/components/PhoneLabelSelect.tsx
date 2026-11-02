"use client";

import { useState } from "react";
import { PHONE_LABELS, cleanPhoneLabel } from "@/lib/contact-display";

const CUSTOM = "__custom__";

/** Phone label dropdown (Cust / Contact / Dealership / Auction / Cell / Home / Work / Other) plus "Custom…" to type any label. */
export default function PhoneLabelSelect({ name, value, onChange, ariaLabel }: { name: string; value: string; onChange: (v: string) => void; ariaLabel: string }) {
  const [typing, setTyping] = useState(false);
  const extra = value && !(PHONE_LABELS as readonly string[]).includes(value) ? [value] : [];
  if (typing) return (
    <input name={name} aria-label={ariaLabel} value={value} autoFocus maxLength={20} placeholder="Label" className="phone-label-custom" data-testid={`${name}-custom`}
      onChange={e => onChange(e.target.value)} onBlur={() => { onChange(cleanPhoneLabel(value)); setTyping(false); }}
      onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLInputElement).blur(); } }} />
  );
  return (
    <select name={name} aria-label={ariaLabel} value={value} onChange={e => { if (e.target.value === CUSTOM) { onChange(""); setTyping(true); } else onChange(e.target.value); }}>
      <option value=""></option>
      {[...extra, ...PHONE_LABELS].map(item => <option key={item} value={item}>{item}</option>)}
      <option value={CUSTOM}>Custom…</option>
    </select>
  );
}
