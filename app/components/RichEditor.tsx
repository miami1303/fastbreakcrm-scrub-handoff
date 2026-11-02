"use client";

// Light rich-text editor (contenteditable + execCommand, no extra dependencies). Used by
// Free Text Email and Extra Stop / Notes. The HTML it produces is ALWAYS sanitized again on
// the server (lib/templates/sanitize.ts) before it is saved or sent.
import { useEffect, useRef, useState } from "react";

export type RichEditorProps = {
  initialHtml?: string;
  onChange: (html: string) => void;
  placeholder?: string;
  /** Insert-image button (Free Text Email). */
  images?: boolean;
  /** Full toolbar (color, lists, alignment, indent, line, table, print). */
  full?: boolean;
  minHeight?: number;
  testId?: string;
  /** Merge-field chips (Maintenance > Email Center): click inserts {key} at the cursor. */
  mergeFields?: { key: string; label: string }[];
};

const SIZES: [string, string][] = [["2", "Small"], ["3", "Normal"], ["4", "Large"], ["5", "Larger"], ["6", "Huge"]];
const COLORS = ["#172033", "#B12E39", "#26446E", "#1a4fb4", "#2E7D4F", "#8a5a00", "#6b7280"];
export const safeUrl = (u: string) => /^(https?:\/\/|mailto:)\S+$/i.test(u.trim());

export default function RichEditor({ initialHtml = "", onChange, placeholder = "Type something", images = false, full = false, minHeight = 160, testId = "rich-editor", mergeFields }: RichEditorProps) {
  const ref = useRef<HTMLDivElement>(null);
  const range = useRef<Range | null>(null);
  const [link, setLink] = useState<{ name: string; url: string } | null>(null);
  const [linkError, setLinkError] = useState("");

  useEffect(() => {
    if (ref.current) ref.current.innerHTML = initialHtml;
    try { document.execCommand("styleWithCSS", false, "true"); } catch { /* older browsers */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const emit = () => onChange(ref.current?.innerHTML || "");
  const saveRange = () => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount && ref.current?.contains(sel.anchorNode)) range.current = sel.getRangeAt(0).cloneRange();
  };
  const restore = () => {
    ref.current?.focus();
    const sel = window.getSelection();
    if (range.current && sel) { sel.removeAllRanges(); sel.addRange(range.current); }
  };
  const cmd = (name: string, value?: string) => { restore(); document.execCommand(name, false, value); saveRange(); emit(); };
  const Btn = ({ title, onClick, children, id }: { title: string; onClick: () => void; children: React.ReactNode; id?: string }) => (
    <button type="button" title={title} aria-label={title} data-testid={id} className="re-btn" onMouseDown={e => e.preventDefault()} onClick={onClick}>{children}</button>
  );

  function openLink() {
    saveRange();
    setLinkError("");
    setLink({ name: range.current ? range.current.toString() : "", url: "https://" });
  }
  function insertLink() {
    if (!link) return;
    const url = link.url.trim(), name = link.name.trim();
    if (!safeUrl(url)) return setLinkError("Use a link that starts with https://, http:// or mailto:");
    if (!name) return setLinkError("Type the link name the customer will see.");
    restore();
    const a = document.createElement("a");
    a.href = url; a.target = "_blank"; a.rel = "noopener noreferrer"; a.textContent = name;
    const r = range.current;
    if (r) { r.deleteContents(); r.insertNode(a); r.setStartAfter(a); r.collapse(true); }
    else ref.current?.appendChild(a);
    setLink(null); emit();
  }
  function insertImage() {
    const url = window.prompt("Image URL (https://...)", "https://");
    if (url && /^https:\/\/\S+$/i.test(url.trim())) cmd("insertImage", url.trim());
  }
  function insertTable() {
    cmd("insertHTML", '<table style="border-collapse:collapse;width:100%"><tbody><tr><td style="border:1px solid #000">&nbsp;</td><td style="border:1px solid #000">&nbsp;</td></tr><tr><td style="border:1px solid #000">&nbsp;</td><td style="border:1px solid #000">&nbsp;</td></tr></tbody></table><p></p>');
  }
  function print() {
    const w = window.open("", "_blank", "noopener=no,width=800,height=600");
    if (!w) return;
    w.document.write(`<!DOCTYPE html><html><head><title>Print</title></head><body style="font-family:Arial,sans-serif;font-size:13px">${ref.current?.innerHTML || ""}</body></html>`);
    w.document.close(); w.focus(); w.print();
  }

  return (
    <div className="re" data-testid={testId}>
      <div className="re-toolbar" role="toolbar">
        <Btn title="Bold" onClick={() => cmd("bold")} id="re-bold"><b>B</b></Btn>
        <Btn title="Italic" onClick={() => cmd("italic")}><i>I</i></Btn>
        <Btn title="Underline" onClick={() => cmd("underline")}><u>U</u></Btn>
        <select className="re-select" title="Font size" aria-label="Font size" defaultValue="" onMouseDown={saveRange} onChange={e => { cmd("fontSize", e.target.value); e.target.value = ""; }}>
          <option value="" disabled>Size</option>
          {SIZES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        {full && (
          <select className="re-select" title="Text color" aria-label="Text color" defaultValue="" onMouseDown={saveRange} onChange={e => { cmd("foreColor", e.target.value); e.target.value = ""; }}>
            <option value="" disabled>Color</option>
            {COLORS.map(c => <option key={c} value={c} style={{ color: c }}>■ {c}</option>)}
          </select>
        )}
        <span className="re-sep" />
        <Btn title="Hyperlink" onClick={openLink} id="re-link">🔗 Link</Btn>
        {images && <Btn title="Insert image" onClick={insertImage}>🖼</Btn>}
        {full && <>
          <span className="re-sep" />
          <Btn title="Bulleted list" onClick={() => cmd("insertUnorderedList")}>• List</Btn>
          <Btn title="Numbered list" onClick={() => cmd("insertOrderedList")}>1. List</Btn>
          <Btn title="Align left" onClick={() => cmd("justifyLeft")}>⯇</Btn>
          <Btn title="Align center" onClick={() => cmd("justifyCenter")}>≡</Btn>
          <Btn title="Align right" onClick={() => cmd("justifyRight")}>⯈</Btn>
          <Btn title="Indent" onClick={() => cmd("indent")}>→|</Btn>
          <Btn title="Outdent" onClick={() => cmd("outdent")}>|←</Btn>
          <Btn title="Horizontal line" onClick={() => cmd("insertHorizontalRule")}>―</Btn>
          <Btn title="Table" onClick={insertTable}>▦</Btn>
          <Btn title="Print" onClick={print}>🖨</Btn>
        </>}
        <span className="re-sep" />
        <Btn title="Undo" onClick={() => cmd("undo")}>↶</Btn>
        <Btn title="Redo" onClick={() => cmd("redo")}>↷</Btn>
      </div>
      {mergeFields?.length ? (
        <div className="re-merge" data-testid="re-merge-chips" style={{ display: "flex", flexWrap: "wrap", gap: 4, margin: "4px 0" }}>
          {mergeFields.map(f => (
            <button key={f.key} type="button" className="role-pill" title={`Insert {${f.key}}`} onMouseDown={e => e.preventDefault()}
              onClick={() => cmd("insertText", `{${f.key}}`)} data-testid={`merge-${f.key}`} style={{ cursor: "pointer", border: 0 }}>{f.label}</button>
          ))}
        </div>
      ) : null}
      {link && (
        <div className="re-link" data-testid="re-link-form">
          <label>Link name (what the customer sees)<input value={link.name} onChange={e => setLink({ ...link, name: e.target.value })} placeholder="e.g. Pay Deposit Online Here" data-testid="re-link-name" /></label>
          <label>URL<input value={link.url} onChange={e => setLink({ ...link, url: e.target.value })} placeholder="https://..." data-testid="re-link-url" /></label>
          <button type="button" className="btn btn-primary" onClick={insertLink} data-testid="re-link-insert">Insert link</button>
          <button type="button" className="btn" onClick={() => setLink(null)}>Cancel</button>
          {linkError && <small className="error-text">{linkError}</small>}
        </div>
      )}
      <div ref={ref} className="re-area" contentEditable suppressContentEditableWarning data-placeholder={placeholder} style={{ minHeight }}
        onInput={emit} onKeyUp={saveRange} onMouseUp={saveRange} onBlur={saveRange} data-testid={`${testId}-area`} />
    </div>
  );
}
