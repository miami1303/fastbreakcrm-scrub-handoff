"use client";

// Extra Stop / Notes window. Pre-filled with the current notes; Submit applies the edit to
// the lead form, and Submit Charges saves it (that's when the customer's order changes).
// Clearing it removes the section from the customer documents.
import { useState } from "react";
import RichEditor from "@/app/components/RichEditor";

export default function ExtraNotesModal({ jobNumber, html, onClose, onApply }: {
  jobNumber: string | null; html: string; onClose: () => void; onApply: (html: string) => void;
}) {
  const [value, setValue] = useState(html);
  return (
    <div className="modal-backdrop">
      <div className="modal modal-wide" data-testid="extra-notes-modal">
        <div className="ft-head">Extra Stop / Notes <span className="job">{jobNumber}</span></div>
        <p className="ft-sub">Your notes appear in the Auto Transport Order</p>
        <RichEditor initialHtml={html} onChange={setValue} full testId="extra-editor" minHeight={220} />
        <div className="ft-actions">
          <button type="button" className="btn btn-primary" onClick={() => onApply(value)} data-testid="extra-submit">Submit</button>
          <button type="button" className="btn" onClick={onClose} data-testid="extra-exit">Exit</button>
        </div>
      </div>
    </div>
  );
}
