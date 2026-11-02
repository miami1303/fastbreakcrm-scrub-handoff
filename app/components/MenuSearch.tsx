"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { searchLeads } from "@/app/actions/leads";
import EsignBadges from "@/app/components/EsignBadges";
import { milesLabel } from "@/lib/mileage";
import { phoneForField } from "@/lib/phone-format";

type Result = Extract<Awaited<ReturnType<typeof searchLeads>>, { ok: true }>["results"][number];

/** Search page (opened from the menu search box / Advanced Search): results as you type (name 3+ letters, phone digits, email, job #). */
export default function MenuSearch({ initial = "" }: { initial?: string }) {
  const [q, setQ] = useState(initial);
  const [results, setResults] = useState<Result[]>([]);
  const seq = useRef(0);
  const [submitted, setSubmitted] = useState(0);
  useEffect(() => {
    const term = q.trim();
    if (term.length < 3) { setResults([]); return; }
    const mine = ++seq.current;
    const t = setTimeout(async () => {
      const r = await searchLeads(term);
      if (mine === seq.current) setResults(r.ok ? r.results : []);
    }, submitted ? 0 : 200);
    return () => clearTimeout(t);
  }, [q, submitted]);
  return (
    <div>
      <form className="search-bar" onSubmit={e => { e.preventDefault(); setSubmitted(n => n + 1); }}>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search name, phone, email, or job #" aria-label="Search" data-testid="search-input" autoFocus />
        <button type="submit" className="btn btn-primary" data-testid="search-btn">Search</button>
      </form>
      {results.length > 0 && (
        <div className="search-results" data-testid="search-results">
          {results.map(r => (
            <Link key={r.id} href={`/estimates/${r.id}`} target="_blank" rel="noopener" data-newtab className={`result-row${r.status === "booked" ? " row-booked" : ""}`}>
              <strong>{r.job_number}</strong> {r.customer_name} — {(r.customer_phone ? phoneForField(r.customer_phone) || r.customer_phone : "") || r.customer_email || ""}{r.miles != null ? <small className="muted" style={{ margin: "0 6px" }}>{milesLabel(r.miles, r.miles_source)}</small> : " "}
              {r.status === "booked" ? <span className="pill-booked">JOB BOOKED</span> : r.status === "cancelled" ? <span className="pill-cancelled" data-testid="search-cancelled">CANCELLED</span> : <span className="role-pill">{r.status}</span>}{" "}
              <EsignBadges quote={r.quoteSigned} cc={r.ccSigned} caption={false} />
            </Link>
          ))}
        </div>
      )}
      {q.trim().length >= 3 && results.length === 0 && <p className="muted" style={{ margin: "0 0 10px", fontSize: 12 }}>No matches.</p>}
    </div>
  );
}
