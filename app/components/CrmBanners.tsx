"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { getBannerState, getRecurring, markSeen, type FollowUpItem, type NotificationItem } from "@/app/actions/banners";
import { BANNERS, BANNER_DIRECTION, BANNER_TRAVEL_MS, KIND_TO_BANNER, STICKY_BANNERS, CLEAR_ON_LEAD_OPEN, RANGES, RANGE_LABELS, RECURRING_TAB, bannerCountLabel, emailKindLabel, rangeBounds, type BannerKey, type RangeKey } from "@/lib/crm-constants";
import { SendChatButton } from "@/app/components/SendChatButton";
import EsignBadges from "@/app/components/EsignBadges";
import { isFollowUpDue } from "@/lib/follow-up-rule";

type State = Extract<Awaited<ReturnType<typeof getBannerState>>, { ok: true }>;
type RecurringRow = Awaited<ReturnType<typeof getRecurring>>["rows"][number];
type Toast = { id: string; kind: "contract_signed" | "cc_signed"; message: string; estimateId: string | null; latencyMs: number };

const label = bannerCountLabel;
const fmt = (iso: string) => new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };

/** Banner bar + instant e-sign popup. Live via Supabase Realtime; 60 s poll only as a fallback. */
const LEAD_PATH = /^\/estimates\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/|$)/i;

export default function CrmBanners() {
  const path = usePathname();
  const focusId = LEAD_PATH.exec(path || "")?.[1];
  const [state, setState] = useState<State | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [open, setOpen] = useState<BannerKey | "recurring" | null>(null);
  const [range, setRange] = useState<RangeKey>("today");
  const [recurring, setRecurring] = useState<RecurringRow[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [live, setLive] = useState(false);
  const refreshing = useRef(false);

  const refresh = useCallback(async () => {
    if (refreshing.current) return;
    refreshing.current = true;
    try {
      const s = await getBannerState(focusId);
      if (s.ok) setState(s);
    } finally { refreshing.current = false; }
  }, [focusId]);

  useEffect(() => { refresh(); }, [refresh]);
  // Follow-ups turn on at their exact date/time: re-check the clock locally every 10 s.
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 10_000); return () => clearInterval(t); }, []);
  // Fallback only: a slow poll in case the realtime socket drops.
  useEffect(() => { const t = setInterval(() => { if (!document.hidden) refresh(); }, 60_000); return () => clearInterval(t); }, [refresh]);
  // Same-tab changes (a note or email clears a follow-up) refresh immediately.
  useEffect(() => {
    const h = () => refresh();
    window.addEventListener("crm:refresh-banners", h);
    return () => window.removeEventListener("crm:refresh-banners", h);
  }, [refresh]);

  const userId = state?.userId;
  const token = state?.realtimeToken;
  const isManager = state?.isManager;
  useEffect(() => {
    if (!userId || !token) return;
    const supabase = createClient();
    supabase.realtime.setAuth(token);
    const channel = supabase
      .channel(`crm-notify-${userId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "crm_notifications", filter: `user_id=eq.${userId}` }, payload => {
        const n = payload.new as NotificationItem;
        if (n.kind === "contract_signed" || n.kind === "cc_signed") {
          const latencyMs = Math.max(0, Date.now() - new Date(n.created_at).getTime());
          setToasts(t => [...t, { id: n.id, kind: n.kind as Toast["kind"], message: n.message, estimateId: n.estimate_id, latencyMs }]);
        }
        setState(s => (s ? { ...s, notifications: [n, ...s.notifications.filter(x => x.id !== n.id)] } : s));
        window.dispatchEvent(new CustomEvent("crm:notification", { detail: n }));
        refresh();
      });
    // Lead changes (a note/email touch, a new follow-up time) update the counts live:
    // managers watch every lead, reps their own.
    channel.on("postgres_changes", isManager
      ? { event: "*", schema: "public", table: "estimates" }
      : { event: "*", schema: "public", table: "estimates", filter: `owner_id=eq.${userId}` }, () => refresh());
    channel.subscribe(status => setLive(status === "SUBSCRIBED"));
    return () => { supabase.removeChannel(channel); };
  }, [userId, token, isManager, refresh]);

  const dueFollowUps = useMemo(() => (state?.followUps || []).filter(f => isFollowUpDue(f.follow_up_at, f.last_touched_at, now)), [state, now]);
  const unseen = useMemo(() => {
    const out: Partial<Record<BannerKey, NotificationItem[]>> = {};
    for (const n of state?.notifications || []) {
      if (n.dismissed_at) continue;
      const key = KIND_TO_BANNER[n.kind];
      if (key) (out[key] ||= []).push(n);
    }
    return out;
  }, [state]);

  useEffect(() => {
    if (open !== "recurring") return;
    getRecurring(range, new Date().getTimezoneOffset()).then(r => setRecurring(r.ok ? r.rows : []));
  }, [open, range, state]);

  async function openPanel(key: BannerKey | "recurring") {
    // Assign New Estimate banner (shared by every admin) opens the Assign New Estimates page.
    if (key === "assign") { window.location.assign("/estimates/assign"); return; }
    setOpen(key);
    const keys: BannerKey[] = key === "recurring" ? ["quoteViewed", "emailViewed"] : [key];
    const ids = keys.filter(k => !STICKY_BANNERS.has(k)).flatMap(k => (unseen[k] || []).map(n => n.id));
    if (ids.length) {
      await markSeen(ids);
      refresh();
    }
  }

  // Job Assigned clears only when that lead is opened (focusId = the lead in the URL). Opening the lead
  // also counts as viewing Payment received / Customer pickup / Customer delivered / Carrier owes.
  const openedLeadIds = [...CLEAR_ON_LEAD_OPEN].flatMap(k => unseen[k] || []).filter(n => focusId && n.estimate_id === focusId).map(n => n.id).join(",");
  useEffect(() => {
    if (!openedLeadIds) return;
    markSeen(openedLeadIds.split(",")).then(() => refresh());
  }, [openedLeadIds, refresh]);

  if (!state) return null;
  const counts: { panel: BannerKey | "recurring"; banner: BannerKey; text: string; color: string; count: number }[] = [
    { panel: "followUp", banner: "followUp", text: label(BANNERS.followUp.label, dueFollowUps.length), color: BANNERS.followUp.color, count: dueFollowUps.length },
    { panel: "recurring", banner: "quoteViewed", text: label(BANNERS.quoteViewed.label, unseen.quoteViewed?.length || 0), color: BANNERS.quoteViewed.color, count: unseen.quoteViewed?.length || 0 },
    { panel: "recurring", banner: "emailViewed", text: label(BANNERS.emailViewed.label, unseen.emailViewed?.length || 0), color: BANNERS.emailViewed.color, count: unseen.emailViewed?.length || 0 },
    { panel: "assign", banner: "assign", text: label(BANNERS.assign.label, state.unassigned.length), color: BANNERS.assign.color, count: state.unassigned.length },
    { panel: "newLead", banner: "newLead", text: label(BANNERS.newLead.label, unseen.newLead?.length || 0), color: BANNERS.newLead.color, count: unseen.newLead?.length || 0 },
    { panel: "esignContract", banner: "esignContract", text: label(BANNERS.esignContract.label, unseen.esignContract?.length || 0), color: BANNERS.esignContract.color, count: unseen.esignContract?.length || 0 },
    { panel: "jobAssigned", banner: "jobAssigned", text: label(BANNERS.jobAssigned.label, unseen.jobAssigned?.length || 0), color: BANNERS.jobAssigned.color, count: unseen.jobAssigned?.length || 0 },
    { panel: "carrierOwes", banner: "carrierOwes", text: label(BANNERS.carrierOwes.label, unseen.carrierOwes?.length || 0), color: BANNERS.carrierOwes.color, count: unseen.carrierOwes?.length || 0 },
    ...(["paymentReceived", "customerPickup", "customerDelivered", "needsCarrier", "carrierPaid"] as const).map(k => ({ panel: k, banner: k, text: label(BANNERS[k].label, unseen[k]?.length || 0), color: BANNERS[k].color, count: unseen[k]?.length || 0 })),
    { panel: "esignCc", banner: "esignCc", text: label(BANNERS.esignCc.label, unseen.esignCc?.length || 0), color: BANNERS.esignCc.color, count: unseen.esignCc?.length || 0 },
  ];
  const active = counts.filter(c => c.count > 0);
  const [rs, re] = rangeBounds(range);
  const inRange = (iso: string) => { const t = new Date(iso); return t >= rs && t < re; };
  const panelItems = open && open !== "recurring" && open !== "followUp" && open !== "assign"
    ? state.notifications.filter(n => KIND_TO_BANNER[n.kind] === open && (open === "needsCarrier" ? !n.dismissed_at : inRange(n.created_at)))
    : [];

  return (
    <>
      {/* Each banner travels once to the center and stays. It does not loop. */}
      <div className="crm-banners crm-lane" data-testid="crm-banners" data-live={live ? "1" : "0"}>
        {active.length === 0
          ? <span className="ticker-idle">No new activity</span>
          : active.map(item => (
            <div className="banner-row" key={`${item.banner}-${item.text}`}>
              <button
                type="button"
                className={`ticker-item banner-slide ${BANNER_DIRECTION[item.banner]}${STICKY_BANNERS.has(item.banner) ? " banner-loop" : ""}`}
                style={{ color: item.color, animationDuration: `${BANNER_TRAVEL_MS}ms` }}
                onClick={() => openPanel(item.panel)}
                data-banner={item.panel}
                data-direction={BANNER_DIRECTION[item.banner]}
              >
                <span className="ticker-dot" style={{ background: item.color }} aria-hidden="true" />
                {item.banner === "esignContract" && <span className="ticker-icon" style={{ background: item.color }} aria-hidden="true">$</span>}
                {item.banner === "esignCc" && <span className="ticker-icon" style={{ background: item.color }} aria-hidden="true">CC</span>}
                {item.text}
              </button>
            </div>
          ))}
      </div>

      {open && (
        <div className="crm-panel" role="dialog" aria-label="Banner list" data-testid="banner-panel">
          <header>
            <h3>{open === "recurring" ? RECURRING_TAB : BANNERS[open].label}</h3>
            <button type="button" className="btn" onClick={() => setOpen(null)}>Close</button>
          </header>
          {open !== "followUp" && open !== "assign" && (
            <div className="filters">
              {RANGES.map(r => <button key={r} type="button" className={`filter-button${range === r ? " selected" : ""}`} onClick={() => setRange(r)}>{RANGE_LABELS[r]}</button>)}
            </div>
          )}
          {open === "followUp" && <FollowUpList items={dueFollowUps} />}
          {open === "assign" && (
            <table className="mini-table"><thead><tr><th>Job No</th><th>Customer</th><th>Created</th></tr></thead><tbody>
              {state.unassigned.map(u => <tr key={u.id}><td><Link href="/estimates/assign">{u.job_number}</Link></td><td>{u.customer_name}</td><td>{fmt(u.created_at)}</td></tr>)}
            </tbody></table>
          )}
          {open === "recurring" && <RecurringTable rows={recurring} />}
          {panelItems.length > 0 && (
            <table className="mini-table"><tbody>
              {panelItems.map(n => <tr key={n.id}><td style={{ whiteSpace: "nowrap" }}>{fmt(n.created_at)}</td><td>{n.estimate_id ? <Link href={`/estimates/${n.estimate_id}`} target="_blank" rel="noopener noreferrer">{n.message}</Link> : n.message}</td></tr>)}
            </tbody></table>
          )}
          {open !== "followUp" && open !== "assign" && open !== "recurring" && panelItems.length === 0 && <p className="muted" style={{ padding: "0 14px" }}>Nothing for {RANGE_LABELS[range].toLowerCase()}.</p>}
        </div>
      )}

      {toasts.map(t => (
        <div key={t.id} className={`toast-signed${t.kind === "cc_signed" ? " cc" : ""}`} role="alert" data-testid="esign-toast" data-latency-ms={t.latencyMs}>
          <span className="dollar">{t.kind === "cc_signed" ? "CC" : "$"}</span>
          <span>
            {t.kind === "cc_signed" ? "CC form E-sign received" : t.message.split(":")[0]}
            <small>{t.message.includes(":") ? t.message.slice(t.message.indexOf(":") + 1).trim() : ""}</small>
            <span style={{ display: "flex", gap: 8, marginTop: 6, alignItems: "center" }}>
              <EsignBadges quote={t.kind === "contract_signed"} cc={t.kind === "cc_signed"} caption={false} />
              {t.estimateId && <Link href={`/estimates/${t.estimateId}`} style={{ color: "#fff", textDecoration: "underline", fontSize: 12 }}>Open job</Link>}
              <button type="button" onClick={() => setToasts(x => x.filter(y => y.id !== t.id))} style={{ background: "none", border: 0, color: "#fff", cursor: "pointer", fontSize: 12 }}>Dismiss</button>
            </span>
          </span>
        </div>
      ))}
    </>
  );
}

function FollowUpList({ items }: { items: FollowUpItem[] }) {
  const today = startOfToday();
  if (!items.length) return <p className="muted" style={{ padding: "0 14px" }}>No follow-ups due.</p>;
  return (
    <table className="mini-table" data-testid="followup-list"><thead><tr><th>Scheduled</th><th>Job No</th><th>Customer</th><th>Rep</th><th></th></tr></thead><tbody>
      {items.map(f => (
        <tr key={f.id}>
          <td>{fmt(f.follow_up_at)}</td>
          <td><Link href={`/estimates/${f.id}`} target="_blank" rel="noopener noreferrer">{f.job_number}</Link></td>
          <td>{f.customer_name}</td>
          <td>{f.rep}</td>
          <td>{new Date(f.follow_up_at) < today ? <span className="overdue">OVERDUE</span> : <span className="muted" style={{ margin: 0, fontSize: 11 }}>Due</span>}</td>
        </tr>
      ))}
    </tbody></table>
  );
}

function RecurringTable({ rows }: { rows: RecurringRow[] }) {
  if (!rows.length) return <p className="muted" style={{ padding: "0 14px" }}>No customer activity in this range.</p>;
  return (
    <div className="table-wrap">
      <table className="mini-table" data-testid="recurring-table"><thead><tr>
        <th>Job No</th><th>Rep</th><th>Status</th><th>Occurred</th><th>Follow-Up</th><th>Pickup</th><th>Customer</th><th>Origin / Destination</th><th>Vehicle</th><th>E-sign</th><th>E-quote</th><th>Email</th><th>IP</th>
      </tr></thead><tbody>
        {rows.map(r => (
          <tr key={r.id} className={r.status === "booked" ? "row-booked" : ""}>
            <td><Link href={`/estimates/${r.estimate_id}`} target="_blank" rel="noopener noreferrer">{r.job_number}</Link></td>
            <td>{r.rep}</td>
            <td>{r.status === "booked" ? <span className="pill-booked">Booked</span> : "Follow-Up"} · {r.priority_text}</td>
            <td>{fmt(r.occurred_at)} <small className="muted">{r.activity}</small>{r.suggestChat && <div style={{ marginTop: 4 }}><SendChatButton estimateId={r.estimate_id} /></div>}</td>
            <td>{r.follow_up_at ? fmt(r.follow_up_at) : ""}</td>
            <td>{r.pickup_date || ""}</td>
            <td>{r.customer}</td>
            <td>{r.origin} → {r.destination}</td>
            <td>{r.vehicle}</td>
            <td>{r.esign ? "Yes" : ""}</td>
            <td>{r.equote ? "Yes" : ""}</td>
            <td>{emailKindLabel(r.email_kind)}</td>
            <td>{r.ip || ""}</td>
          </tr>
        ))}
      </tbody></table>
    </div>
  );
}
