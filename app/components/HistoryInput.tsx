"use client";

// Free-text box with the old CRM's "previously typed" list (Owner 2026-10-31): the box starts
// EMPTY (no placeholder text). Clicking an empty box (or typing) shows a dropdown of values
// typed before for this field type; each has an x to forget it. Nothing is pre-filled.
// History lives in this browser (localStorage), per field type.
import { useEffect, useRef, useState } from "react";

const KEY = (kind: string) => `crm.history.${kind}`;
const MAX = 30;

export function readHistory(kind: string): string[] {
  try { const v = JSON.parse(localStorage.getItem(KEY(kind)) || "[]"); return Array.isArray(v) ? v.filter(x => typeof x === "string") : []; } catch { return []; }
}
function writeHistory(kind: string, list: string[]) {
  try { localStorage.setItem(KEY(kind), JSON.stringify(list.slice(0, MAX))); } catch { /* storage blocked */ }
}
export function rememberValue(kind: string, value: string) {
  const v = value.trim();
  if (!v) return;
  writeHistory(kind, [v, ...readHistory(kind).filter(x => x.toLowerCase() !== v.toLowerCase())]);
}

type Props = Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "placeholder"> & {
  kind: string; value: string; onValue: (v: string) => void;
};

export default function HistoryInput({ kind, value, onValue, onBlur, onFocus, ...rest }: Props) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<string[]>([]);
  const wrap = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  const q = value.trim().toLowerCase();
  const shown = items.filter(x => !q || (x.toLowerCase().includes(q) && x.toLowerCase() !== q));
  return (
    <span className="hist-wrap" ref={wrap}>
      <input {...rest} value={value} autoComplete="off"
        onFocus={e => { setItems(readHistory(kind)); setOpen(true); onFocus?.(e); }}
        onClick={() => { setItems(readHistory(kind)); setOpen(true); }}
        onChange={e => { onValue(e.target.value); setOpen(true); }}
        onKeyDown={e => { if (e.key === "Escape") setOpen(false); }}
        onBlur={e => { rememberValue(kind, e.target.value); onBlur?.(e); }} />
      {open && shown.length > 0 && (
        <span className="hist-list" role="listbox" data-testid={`hist-${kind}`}>
          {shown.map(x => (
            <span key={x} className="hist-item" role="option" aria-selected={false}>
              <button type="button" className="hist-pick" onMouseDown={e => e.preventDefault()} onClick={() => { onValue(x); setOpen(false); }}>{x}</button>
              <button type="button" className="hist-del" aria-label={`Forget ${x}`} title="Remove from list" onMouseDown={e => e.preventDefault()}
                onClick={() => { const next = readHistory(kind).filter(y => y !== x); writeHistory(kind, next); setItems(next); }}>×</button>
            </span>
          ))}
        </span>
      )}
    </span>
  );
}
