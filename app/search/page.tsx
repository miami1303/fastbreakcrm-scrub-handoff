import Link from "next/link";
import MenuCard from "@/app/components/MenuCard";
import MenuSearch from "@/app/components/MenuSearch";

// SEARCH / ADVANCED SEARCH: its own page (the menu only holds the search box). Results as you
// type: name (3+ letters), phone digits, email or job #. Filters by date / state / priority /
// lead source are on Estimates in Process.
export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  return (
    <MenuCard title="Search" testId="search-page">
      <MenuSearch initial={String(q || "").slice(0, 120)} />
      <p className="muted small">Need date, state, priority or lead source filters? Use <Link href="/estimates" className="job-link">Estimates in Process</Link>.</p>
    </MenuCard>
  );
}
