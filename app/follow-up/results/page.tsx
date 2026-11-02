"use client";

// FOLLOW-UP RESULTS: its own page (Owner 2026-10-31: the table under the filters was too
// cluttered). Opened from the Follow-Up Menu's Submit (?list=&sort=) or a priority bubble
// (?priority=N|none). Job No links open the job in a NEW tab, so this list stays put.
import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { followUpMenuData } from "@/app/actions/lists";
import JobTable from "@/app/components/JobTable";
import MenuCard from "@/app/components/MenuCard";
import { formatPriority } from "@/lib/follow-up-domain";
import { LISTS, SORTS, inList, type ListKey } from "@/lib/follow-up-lists";
import { rowSorter, type SortKey } from "@/lib/job-sort";

type Data = Extract<Awaited<ReturnType<typeof followUpMenuData>>, { ok: true }>;

function Results() {
  const sp = useSearchParams();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { followUpMenuData().then(r => { if (r.ok) setData(r); else setError(r.error); }); }, []);
  const priorityParam = sp.get("priority");
  const listParam = (LISTS.find(l => l.key === sp.get("list"))?.key ?? "all") as ListKey;
  const sortParam = (SORTS.find(s => s.key === sp.get("sort"))?.key ?? "followUp") as SortKey;
  const view = useMemo(() => {
    if (!data) return null;
    if (priorityParam !== null) {
      const p = priorityParam === "none" ? null : Number(priorityParam);
      return { title: formatPriority(data.labels, p, "status"), rows: data.rows.filter(r => r.priority === p).sort(rowSorter("jobAsc")) };
    }
    const now = Date.now();
    return { title: LISTS.find(l => l.key === listParam)!.label, rows: data.rows.filter(r => inList(listParam, r, data.today, now)).sort(rowSorter(sortParam)) };
  }, [data, priorityParam, listParam, sortParam]);

  return (
    <MenuCard title="Follow-Up Results" testId="follow-up-results" wide>
      {error && <p className="status-msg error">{error}</p>}
      {!data || !view ? <p className="muted">Loading…</p> : (
        <section className="results" data-testid="fu-results" data-priority={priorityParam ?? ""}>
          <h2 className="results-title">{view.title} <small>({view.rows.length})</small></h2>
          <JobTable rows={view.rows} labels={data.labels} testId="fu-table" />
        </section>
      )}
      <div className="page-actions"><a className="btn" href="/follow-up" data-testid="fu-back">Back to Follow-Up Menu</a></div>
    </MenuCard>
  );
}

export default function FollowUpResultsPage() {
  return <Suspense fallback={<p className="muted">Loading…</p>}><Results /></Suspense>;
}
