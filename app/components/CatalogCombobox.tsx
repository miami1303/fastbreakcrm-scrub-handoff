"use client";

// One combobox for Year, Make, Model, and Type.
// The box is a normal text field, so a name that is not on the list can be typed and saved.
// Opening the list shows the choices. Typing keeps the ones that start with those letters.
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";

type Box = { left: number; minWidth: number; maxWidth: number; top?: number; bottom?: number };

/** The list is at least as wide as the box (and 240px), grows to fit the longest make / model, and never leaves the screen. */
export const LIST_MIN_WIDTH = 240;
function placeList(anchor: HTMLElement): Box {
  const rect = anchor.getBoundingClientRect();
  const minWidth = Math.min(Math.max(rect.width, LIST_MIN_WIDTH), window.innerWidth - 16);
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - minWidth - 8));
  const maxWidth = Math.max(minWidth, Math.min(420, window.innerWidth - left - 8));
  const spaceBelow = window.innerHeight - rect.bottom;
  if (spaceBelow < 160 && rect.top > spaceBelow) return { left, minWidth, maxWidth, bottom: window.innerHeight - rect.top + 2 };
  return { left, minWidth, maxWidth, top: rect.bottom + 2 };
}

export function CatalogCombobox({
  value, onChange, getOptions, ariaLabel, testId, onFinished, maxLength = 60, inputMode, invalid = false, title,
}: {
  value: string;
  onChange: (value: string) => void;
  /** "" is the list shown when the menu opens. Typed text is the prefix filter. */
  getOptions: (query: string) => string[];
  ariaLabel: string;
  testId?: string;
  onFinished?: (value: string) => void;
  maxLength?: number;
  inputMode?: "numeric" | "text";
  invalid?: boolean;
  title?: string;
}) {
  const listId = useId();
  const wrapRef = useRef<HTMLSpanElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const valueRef = useRef(value);
  valueRef.current = value;
  const [open, setOpen] = useState(false);
  // Until the person types, the open list is the full set, not a filter of the current text.
  const [browsing, setBrowsing] = useState(false);
  const [hi, setHi] = useState(-1);
  const [box, setBox] = useState<Box | null>(null);
  const picked = useRef(false);
  const shown = open ? getOptions(browsing ? "" : value) : [];

  useLayoutEffect(() => {
    if (!open || !wrapRef.current) return;
    const measure = () => { if (wrapRef.current) setBox(placeList(wrapRef.current)); };
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  useEffect(() => {
    if (!open || hi < 0) return;
    listRef.current?.querySelector("[data-active='true']")?.scrollIntoView({ block: "nearest" });
  }, [open, hi, shown.length]);

  function choose(next: string) {
    picked.current = true;
    valueRef.current = next;
    onChange(next);
    setOpen(false);
    setBrowsing(false);
    onFinished?.(next);
    queueMicrotask(() => { picked.current = false; });
  }

  function move(key: "ArrowDown" | "ArrowUp") {
    if (!open) { setOpen(true); setBrowsing(true); setHi(0); return; }
    if (shown.length === 0) return;
    setHi(current => {
      if (key === "ArrowDown") return current < 0 ? 0 : Math.min(current + 1, shown.length - 1);
      return current <= 0 ? 0 : current - 1;
    });
  }

  return (
    <span className="catalog-combo" ref={wrapRef}>
      <input
        ref={inputRef}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open && shown[hi] ? `${listId}-${hi}` : undefined}
        aria-label={ariaLabel}
        data-testid={testId}
        value={value}
        maxLength={maxLength}
        inputMode={inputMode}
        autoComplete="off"
        spellCheck={false}
        title={value ? `${value}${title ? ` — ${title}` : ""}` : title}
        className={invalid ? "invalid" : undefined}
        onFocus={event => { setOpen(true); setBrowsing(true); setHi(-1); event.currentTarget.select(); }}
        onChange={event => { onChange(event.target.value); setBrowsing(false); setOpen(true); setHi(0); }}
        onBlur={() => {
          setOpen(false);
          setBrowsing(false);
          if (picked.current) { picked.current = false; return; }
          onFinished?.(valueRef.current);
        }}
        onKeyDown={event => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); move(event.key); return; }
          if (event.key === "Escape") { if (open) { event.preventDefault(); setOpen(false); } return; }
          if (event.key === "Enter" && open) {
            event.preventDefault();
            const pick = hi >= 0 ? shown[hi] : undefined;
            if (pick) choose(pick);
            else setOpen(false);
          }
        }}
      />
      <button type="button" tabIndex={-1} className="catalog-combo-btn" aria-label={`Show ${ariaLabel} choices`}
        onMouseDown={event => event.preventDefault()}
        onClick={() => {
          if (open) { setOpen(false); return; }
          setOpen(true); setBrowsing(true); setHi(-1);
          inputRef.current?.focus();
        }}>▾</button>
      {open && box && (
        <ul ref={listRef} id={listId} role="listbox" className="catalog-combo-list" data-testid={testId ? `${testId}-list` : undefined}
          style={{ left: box.left, minWidth: box.minWidth, maxWidth: box.maxWidth, top: box.top, bottom: box.bottom }}>
          {shown.map((option, index) => (
            <li key={`${option}-${index}`} id={`${listId}-${index}`} role="option" aria-selected={index === hi}
              data-active={index === hi ? "true" : undefined}
              className={index === hi ? "hi" : undefined}
              data-testid={testId ? `${testId}-opt` : undefined}
              onMouseEnter={() => setHi(index)}
              title={option}
              onMouseDown={event => { event.preventDefault(); choose(option); }}>
              {option}
            </li>
          ))}
          {shown.length === 0 && <li className="muted">Not listed. What you type is kept.</li>}
        </ul>
      )}
    </span>
  );
}
