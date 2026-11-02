"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

export const LEAD_TABS = [
  { key: "entry", label: "Entry Form", path: "/entry" },
  { key: "charges", label: "Charges", path: "" },
  { key: "payments", label: "Payments", path: "/payments" },
  { key: "estimate", label: "Printed Estimate", path: "/estimate" },
  { key: "emails", label: "Emails", path: "/emails" },
  // Admins and supervisors only (admin facts + discount, from existing lead data).
  { key: "admin", label: "Admin", path: "/admin" },
] as const;
export type LeadTabKey = (typeof LEAD_TABS)[number]["key"];

export function activeLeadTab(pathname: string): LeadTabKey {
  const last = pathname.split("/").filter(Boolean).pop() || "";
  if (last === "new" || last === "entry" || last === "vehicles") return "entry";
  const t = LEAD_TABS.find(x => x.path && x.path === `/${last}`);
  return t ? t.key : "charges";
}

/** Tab bar across the top of every lead page. base = /estimates/<id>, or null on a NEW estimate. */
export default function LeadTabBar({ base, dirty = false, showAdmin = false }: { base: string | null; dirty?: boolean; showAdmin?: boolean }) {
  const pathname = usePathname() || "";
  const router = useRouter();
  const active = activeLeadTab(pathname);
  return (
    <nav className="lead-tabs" aria-label="Lead" data-testid="lead-tabs">
      {LEAD_TABS.filter(t => t.key !== "admin" || showAdmin).map(t => {
        const on = t.key === active;
        if (!base && t.key !== "entry") return <span key={t.key} className="lead-tab disabled" aria-disabled="true" title="Save the Entry Form first" data-testid={`lead-tab-${t.key}`}>{t.label}</span>;
        // New Estimate (no lead yet): the Entry Form tab is the current page, not a "#" link.
        if (!base) return <span key={t.key} className="lead-tab active" aria-current="page" data-testid={`lead-tab-${t.key}`}>{t.label}</span>;
        return (
          <Link key={t.key} href={`${base}${t.path}`} className={`lead-tab${on ? " active" : ""}`} aria-current={on ? "page" : undefined} data-testid={`lead-tab-${t.key}`}>{t.label}</Link>
        );
      })}
      <button type="button" className="lead-tab exit" data-testid="lead-tab-exit"
        onClick={() => { if (!dirty || window.confirm("Leave without saving your changes?")) router.push("/user-menu"); }}>Exit</button>
    </nav>
  );
}
