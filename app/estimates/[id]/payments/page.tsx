"use client";

import PaymentsPanel from "../payments-panel";
import { useLead } from "../lead-context";

export default function PaymentsTab() {
  const { lead, reload } = useLead();
  return <section className="lead-card" data-testid="tab-payments"><PaymentsPanel lead={lead} onChanged={() => reload(false)} /></section>;
}
