"use client";

// Required Lead Source dropdown with type-to-filter (rep-side only).
import { useEffect, useRef, useState } from "react";
import { filterLeadSources, pickableLeadSources, type LeadSourceOption } from "@/lib/lead-sources";

export default function LeadSourceSelect({ value, onChange, options, name = "lead_source", invalid = false }: {
  value: string; onChange: (v: string) => void; options: LeadSourceOption[]; name?: string; invalid?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hi, setHi] = useState(0);
  const wrap = useRef<HTMLSpanElement>(null);
  const list = filterLeadSources(pickableLeadSources(options, value), q);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);
  const pick = (v: string) => { onChange(v); setOpen(false); setQ(""); };
  return (
    <span className="ls-wrap" ref={wrap}>
      <input type="hidden" name={name} value={value} />
      <button type="button" className={`ls-btn${value ? "" : " empty"}${invalid && !value ? " invalid" : ""}`} aria-haspopup="listbox" aria-label="Lead Source"
        onClick={() => { setOpen(o => !o); setHi(0); }} data-testid="lead-source">{value || "Select Lead Source…"}<span aria-hidden="true">▾</span></button>
      {open && (
        <div className="ls-pop" data-testid="lead-source-pop">
          <input autoFocus value={q} placeholder="Type to filter…" aria-label="Filter lead sources" data-testid="lead-source-filter"
            onChange={e => { setQ(e.target.value); setHi(0); }}
            onKeyDown={e => {
              if (e.key === "ArrowDown") { e.preventDefault(); setHi(h => Math.min(h + 1, list.length - 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setHi(h => Math.max(h - 1, 0)); }
              else if (e.key === "Enter") { e.preventDefault(); if (list[hi]) pick(list[hi]); }
              else if (e.key === "Escape") setOpen(false);
            }} />
          <ul role="listbox">
            {list.map((l, i) => <li key={l} role="option" aria-selected={l === value} className={`${i === hi ? "hi" : ""}${l === value ? " sel" : ""}`} onMouseDown={e => { e.preventDefault(); pick(l); }} data-testid="lead-source-opt">{l}</li>)}
            {list.length === 0 && <li className="muted">No match</li>}
          </ul>
        </div>
      )}
    </span>
  );
}
