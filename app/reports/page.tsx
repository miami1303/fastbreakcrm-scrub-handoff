import Link from "next/link";
import MenuCard from "@/app/components/MenuCard";

// REPORTS: its own page listing the reports that exist today (each opens its own page).
export default function ReportsPage() {
  const items: [string, string, string][] = [
    ["/performance", "Salesmen Performance", "Leads, quotes, booked jobs and booked total per rep, plus counts by Lead Source (reps see their own row)."],
    ["/operations", "Booked Jobs (Operations Calendar)", "Booked pick-ups by month or week, with 2nd pick-up dates."],
    ["/recurring", "Recurring Customers", "Customers who re-opened their quote."],
    ["/estimates", "Estimates in Process", "Open leads by date, state, priority, lead source and rep."],
  ];
  return (
    <MenuCard title="Reports" testId="reports-page">
      <ul className="report-list" data-testid="report-list">
        {items.map(([href, label, note]) => <li key={href}><Link href={href} className="job-link" data-testid="report-link">{label}</Link><small className="muted"> — {note}</small></li>)}
      </ul>
    </MenuCard>
  );
}
