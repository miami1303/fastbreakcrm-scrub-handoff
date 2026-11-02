"use client";

// FOLLOW-UP MENU: priority circles (the company's labels, plus any number already on a lead,
// and No Priority), then Follow-Up list + Sort By. Submit / a bubble opens the results on their
// OWN page (/follow-up/results), never appended under the filters (Owner 2026-10-31).
// Only OPEN leads count: a booked job is operations, never a follow-up.
import { useEffect, useMemo, useState } from "react";
import { followUpMenuData } from "@/app/actions/lists";
import MenuCard from "@/app/components/MenuCard";
import { priorityColor } from "@/lib/crm-constants";
import { formatPriority, priorityCircleNumbers } from "@/lib/follow-up-domain";
import { useRouter } from "next/navigation";
import { LISTS, SORTS, inList, type ListKey } from "@/lib/follow-up-lists";
import type { SortKey } from "@/lib/job-sort";

type Data = Extract<Awaited<ReturnType<typeof followUpMenuData>>, { ok: true }>;
export default function FollowUpMenuPage() {
  const [data, setData] = useState<Data | null>(null);
  const [rep, setRep] = useState("");
  const [list, setList] = useState<ListKey>("untouched");
  const [sort, setSort] = useState<SortKey>("followUp");
  const router = useRouter();
  const [error, setError] = useState("");
  useEffect(() => { followUpMenuData(rep || undefined).then(r => { if (r.ok) setData(r); else setError(r.error); }); }, [rep]);
  const now = Date.now();
  const counts = useMemo(() => {
    if (!data) return null;
    const c = Object.fromEntries(LISTS.map(l => [l.key, data.rows.filter(r => inList(l.key, r, data.today, now)).length])) as Record<ListKey, number>;
    const numbers = priorityCircleNumbers(data.labels, data.rows.map(r => r.priority));
    const p = Object.fromEntries([...numbers.map(n => [String(n), data.rows.filter(r => r.priority === n).length]), ["none", data.rows.filter(r => r.priority === null).length]]);
    return { lists: c, priorities: p, numbers };
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  function submit() {
    router.push(`/follow-up/results?list=${list}&sort=${sort}`);
  }
  // A bubble opens that priority's open follow-up leads (oldest job number first).
  function byPriority(p: number | null) {
    router.push(`/follow-up/results?priority=${p === null ? "none" : p}`);
  }

  return (
    <MenuCard title="Follow-Up Menu" testId="follow-up-menu" wide
      right={data?.manager && <select value={rep} onChange={e => setRep(e.target.value)} aria-label="Rep" data-testid="fu-rep"><option value="">All reps</option>{data.reps.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select>}>
      {error && <p className="status-msg error">{error}</p>}
      {!data || !counts ? <p className="muted">Loading…</p> : <>
        <div className="p-circles" data-testid="priority-circles">
          {counts.numbers.map(p => (
            <button key={p} type="button" className="p-circle" style={{ background: priorityColor(p) }} title={formatPriority(data.labels, p, "status")} onClick={() => byPriority(p)} data-testid={`pcircle-${p}`}>
              <span>{data.labels.find(l => l.number === p)?.label || `Priority ${p}`}</span><b>{counts.priorities[String(p)]}</b>
            </button>
          ))}
        </div>
        <div className="fu-box">
          <fieldset className="fu-col" data-testid="fu-lists">
            <legend>Follow-Up</legend>
            {LISTS.map(l => (
              <label key={l.key} className="fu-opt" data-testid={`fu-opt-${l.key}`}>
                <input type="radio" name="fu-list" checked={list === l.key} onChange={() => setList(l.key)} />
                <span className="fu-label">{l.label}</span><span className="fu-count" data-testid={`fu-count-${l.key}`}>({counts.lists[l.key]})</span>
              </label>
            ))}
          </fieldset>
          <fieldset className="fu-col" data-testid="fu-sorts">
            <legend>Sort By</legend>
            {SORTS.map(s => <label key={s.key} className="fu-opt"><input type="radio" name="fu-sort" checked={sort === s.key} onChange={() => setSort(s.key)} data-testid={`fu-sort-${s.key}`} /><span className="fu-label">{s.label}</span></label>)}
          </fieldset>
        </div>
        <div className="page-actions"><button type="button" className="btn btn-primary" onClick={submit} data-testid="fu-submit">Submit</button><a className="btn" href="/user-menu" data-testid="fu-exit">Exit</a></div>
        <p className="muted small">Booked jobs are not follow-ups: they live on the Operations Calendar. Leads are counted for {data.manager ? (rep ? data.reps.find(r => r.id === rep)?.name : "all reps") : "you"}.</p>
      </>}
    </MenuCard>
  );
}
