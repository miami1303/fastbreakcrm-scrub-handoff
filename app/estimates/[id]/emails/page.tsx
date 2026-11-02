"use client";

import { EmailCenter, PreviousEmails } from "../email-center";
import { useLead } from "../lead-context";

/** EMAILS tab: the Email Center (every template) and the full Previous Emails history. */
export default function EmailsTab() {
  const c = useLead();
  const { lead } = c;
  return (
    <section className="lead-card" data-testid="tab-emails">
      <h2 className="lead-card-title">Emails <small className="muted">to {lead.est.customer_email || "no email on file"} · {lead.emails.length} sent</small></h2>
      <div className="ec-inline">
        <EmailCenter lead={lead} booked={lead.est.status === "booked"} templatesOnly
          onSend={k => c.send(k)} onSendCustomer={(k, n) => c.sendCustomer(k, n)} onFreeText={c.openFreeText} onSnapshot={c.openSnapshot}
          onPaymentLinkSent={(text, ok) => { c.flash(text, !ok); void c.reload(false); }} />
      </div>
      <h3 className="section-title" style={{ marginTop: 10 }}>Previous Emails</h3>
      <PreviousEmails emails={lead.emails} onSnapshot={c.openSnapshot} testId="email-history" optOut />
    </section>
  );
}
