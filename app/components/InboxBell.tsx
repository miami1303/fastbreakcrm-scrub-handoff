"use client";

// Header "Inbox" button + new-mail banner for admins/supervisors (info@ via your mail host IMAP).
// The banner stays until each new email is opened (checked) in the CRM Inbox.
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { inboxUnread } from "@/app/actions/inbox";

export default function InboxBell() {
  const [s, setS] = useState<Awaited<ReturnType<typeof inboxUnread>> | null>(null);
  const path = usePathname();
  useEffect(() => {
    let alive = true;
    const run = () => inboxUnread().then(r => { if (alive) setS(r); }).catch(() => {});
    run();
    // Poll only while this tab is visible (hidden/minimized tabs don't call the server); catch up on return.
    const t = setInterval(() => { if (!document.hidden) run(); }, 60_000);
    const onVis = () => { if (!document.hidden) run(); };
    window.addEventListener("crm-inbox-changed", run);
    window.addEventListener("focus", run);
    document.addEventListener("visibilitychange", onVis);
    return () => { alive = false; clearInterval(t); window.removeEventListener("crm-inbox-changed", run); window.removeEventListener("focus", run); document.removeEventListener("visibilitychange", onVis); };
  }, []);
  if (!s?.ok) return null;
  return (
    <>
      <Link href="/inbox" className="crm-header-menu" data-testid="header-inbox">Email Inbox{s.count > 0 && <b style={{ marginLeft: 6, background: "var(--brand-red)", color: "#fff", borderRadius: 999, padding: "0 7px" }}>{s.count}</b>}</Link>
      {s.count > 0 && path !== "/inbox" && (
        <Link href="/inbox" data-testid="inbox-banner" style={{ position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 50, background: "var(--brand-red)", color: "#fff", padding: "8px 16px", font: "700 14px Arial,Helvetica,sans-serif", textAlign: "center" }}>
          📧 {s.count} new email{s.count > 1 ? "s" : ""} in info@{s.latest && <> — {s.latest.from}: {s.latest.subject}</>} · Open Email Inbox
        </Link>
      )}
    </>
  );
}
