"use client";

// RECENT ACCESSED JOBS: the last 20 leads this user opened (kept in this browser).
import { useEffect, useState } from "react";
import Link from "next/link";
import MenuCard from "@/app/components/MenuCard";
import { crmStamp } from "@/lib/crm-time";

type Item = { id: string; job: string | null; name: string | null; at: string };

export default function RecentPage() {
  const [items, setItems] = useState<Item[] | null>(null);
  useEffect(() => {
    // One list per signed-in user (crm:recent:<userId>); show the most recently used one.
    try {
      const lists = Object.keys(localStorage).filter(k => k.startsWith("crm:recent:")).map(k => JSON.parse(localStorage.getItem(k) || "[]") as Item[]);
      lists.sort((a, b) => (b[0]?.at || "").localeCompare(a[0]?.at || ""));
      setItems(lists[0] || []);
    } catch { setItems([]); }
  }, []);
  return (
    <MenuCard title="Recent Accessed Jobs" testId="recent-page">
      <table className="mini-table job-table" data-testid="recent-table"><thead><tr><th>#</th><th>Job No</th><th>Customer</th><th>Opened</th></tr></thead><tbody>
        {(items || []).map((x, i) => <tr key={x.id}><td>{i + 1}</td><td><Link href={`/estimates/${x.id}`} className="job-link" target="_blank" rel="noopener" data-newtab data-testid="job-link">{x.job}</Link></td><td>{x.name}</td><td>{crmStamp(x.at)}</td></tr>)}
        {items && items.length === 0 && <tr><td colSpan={4} className="muted">No jobs opened yet in this browser.</td></tr>}
      </tbody></table>
      <p className="muted small">The last 20 leads you opened on this computer.</p>
    </MenuCard>
  );
}
