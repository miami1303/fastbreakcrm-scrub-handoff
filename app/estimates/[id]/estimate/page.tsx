"use client";

// PRINTED ESTIMATE: exactly what the customer sees right now (E-Quote before booking, the
// booked Auto Transport Order after), plus the CC Authorization Form. Read-only preview: the
// HTML has no tracking pixel or token, so viewing it never fires Quote Viewed / Email Viewed.
import { useRef, useState } from "react";
import { EmailCenter } from "../email-center";
import { useLead } from "../lead-context";

export default function PrintedEstimateTab() {
  const c = useLead();
  const { lead } = c;
  const booked = lead.est.status === "booked";
  const [doc, setDoc] = useState<"customer" | "cc">("customer");
  const [ec, setEc] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);
  const html = doc === "cc" ? lead.docs.cc : booked ? lead.docs.booked : lead.docs.quote;
  const kind = doc === "cc" ? "cc_form" : booked ? "booked_esign" : "e_quote";

  return (
    <section className="lead-card" data-testid="tab-estimate">
      <div className="pe-bar">
        <div className="pe-toggle" role="tablist">
          <button type="button" role="tab" aria-selected={doc === "customer"} className={doc === "customer" ? "on" : ""} onClick={() => setDoc("customer")} data-testid="pe-customer">
            {booked ? "Auto Transport Order (booked)" : "E-Quote"}
          </button>
          <button type="button" role="tab" aria-selected={doc === "cc"} className={doc === "cc" ? "on" : ""} onClick={() => setDoc("cc")} data-testid="pe-cc">CC Authorization Form</button>
        </div>
        <div className="pe-actions">
          <button type="button" className="btn btn-sm" onClick={() => frame.current?.contentWindow?.print()} data-testid="pe-print">Print</button>
          <span className="pe-send" onMouseLeave={() => setEc(false)}>
            <button type="button" className="btn btn-sm btn-primary" onClick={() => setEc(o => !o)} data-testid="pe-send">Send to customer</button>
            {ec && <EmailCenter lead={lead} booked={booked} templatesOnly
              onSend={k => { setEc(false); c.send(k); }} onSendCustomer={(k, n) => { setEc(false); c.sendCustomer(k, n); }} onFreeText={() => { setEc(false); c.openFreeText(); }} onSnapshot={m => { setEc(false); c.openSnapshot(m); }}
              onPaymentLinkSent={(text, ok) => { setEc(false); c.flash(text, !ok); void c.reload(false); }} />}
          </span>
        </div>
      </div>
      <p className="muted small pe-note">Preview of what {lead.est.customer_name || "the customer"} sees{booked ? " (booked: deposit and balance)" : " (not booked: total only)"}. Viewing it here is not tracked.</p>
      <iframe ref={frame} key={kind} title="Printed estimate" srcDoc={html} data-testid="doc-frame" data-kind={kind} className="pe-frame"
        onLoad={ev => { const d = ev.currentTarget.contentDocument; if (d?.body) ev.currentTarget.style.height = `${d.body.scrollHeight + 24}px`; }} />
    </section>
  );
}
