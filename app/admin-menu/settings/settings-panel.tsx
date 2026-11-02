"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { getSettings, saveRep, setInboxWatchEnabled, setRotationEnabled } from "@/app/actions/settings";

type S = Extract<Awaited<ReturnType<typeof getSettings>>, { ok: true }>;
type Rep = S["reps"][number];
const blank = { name: "", email: "support@fastbreakcrm.test", phone: "", user_id: "", is_active: true, in_rotation: true };

export default function SettingsPanel({ embedded = false }: { embedded?: boolean }) {
  const [s, setS] = useState<S | null>(null);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const [newRep, setNewRep] = useState(blank);
  const load = useCallback(async () => {
    const r = await getSettings();
    if (r.ok) setS(r); else setMsg({ text: r.error, error: true });
  }, []);
  useEffect(() => { load(); }, [load]);
  const done = async (r: { ok: boolean; error?: string }, ok = "Saved.") => { setMsg(r.ok ? { text: ok } : { text: r.error || "Error", error: true }); load(); };

  if (!s) return embedded ? <div className="card">{msg ? <p className="status-msg error">{msg.text}</p> : "Loading…"}</div> : <main className="main-content">{msg ? <p className="status-msg error">{msg.text}</p> : "Loading…"}</main>;
  const body = (
    <>
      {msg && <p className={`status-msg${msg.error ? " error" : ""}`}>{msg.text}</p>}
      <div className="card">
        <h3 className="section-title">Lead rotation</h3>
        <label style={{ display: "flex", gap: 10, alignItems: "center", fontWeight: 600 }}>
          <input type="checkbox" checked={s.rotationEnabled} onChange={async e => { const on = e.target.checked; done(await setRotationEnabled(on), on ? "Rotation is ON." : "Rotation is OFF."); }} data-testid="rotation-toggle" style={{ width: 18, height: 18 }} />
          Rotation {s.rotationEnabled ? "ON" : "OFF"}
        </label>
        <p className="muted" style={{ fontSize: 12 }}>When ON, leads entered with &quot;Lead rotation&quot; go round-robin to active reps marked &quot;In rotation&quot; (linked to a login) and skip Assign New Estimates. A new lead has no priority until someone sets one. Leads deliberately left unassigned still go to Assign New Estimates.</p>
      </div>
      <div className="card">
        <h3 className="section-title">Reps (shown on customer documents)</h3>
        <table className="mini-table"><thead><tr><th>Name</th><th>Email</th><th>Direct phone</th><th>Login</th><th>Active</th><th>In rotation</th><th></th></tr></thead><tbody>
          {s.reps.map(r => <RepRow key={r.id} rep={r} profiles={s.profiles} onSave={async v => done(await saveRep({ ...v, id: r.id }))} />)}
          <tr>
            <td><input value={newRep.name} onChange={e => setNewRep({ ...newRep, name: e.target.value })} placeholder="New rep name" /></td>
            <td><input value={newRep.email} onChange={e => setNewRep({ ...newRep, email: e.target.value })} /></td>
            <td><input value={newRep.phone} onChange={e => setNewRep({ ...newRep, phone: e.target.value })} /></td>
            <td><select value={newRep.user_id} onChange={e => setNewRep({ ...newRep, user_id: e.target.value })}><option value="">—</option>{s.profiles.map(p => <option key={p.user_id} value={p.user_id}>{p.display_name}</option>)}</select></td>
            <td><input type="checkbox" checked={newRep.is_active} onChange={e => setNewRep({ ...newRep, is_active: e.target.checked })} /></td>
            <td><input type="checkbox" checked={newRep.in_rotation} onChange={e => setNewRep({ ...newRep, in_rotation: e.target.checked })} /></td>
            <td><button type="button" className="btn btn-primary" onClick={async () => { const r = await saveRep(newRep); if (r.ok) setNewRep(blank); done(r, "Rep added."); }}>Add</button></td>
          </tr>
        </tbody></table>
      </div>
      {!embedded && <>
        <div className="card">
        <h3 className="section-title">Inbox watch (Fast Break payments + Central Dispatch)</h3>
        <label style={{ display: "flex", gap: 10, alignItems: "center", fontWeight: 600 }}>
          <input type="checkbox" checked={s.inboxWatchEnabled} onChange={async e => { const on = e.target.checked; done(await setInboxWatchEnabled(on), on ? "Inbox watch is ON." : "Inbox watch is OFF."); }} data-testid="inbox-watch-toggle" style={{ width: 18, height: 18 }} />
          Inbox watch {s.inboxWatchEnabled ? "ON" : "OFF"}
        </label>
        <p className="muted" style={{ fontSize: 12 }}>When ON, the CRM checks the connected inbox: Fast Break payment emails raise &quot;Payment received&quot; (customer payments are added to Payments; carrier payments mark Carrier Owes paid), and Central Dispatch pickup / delivered emails raise &quot;Customer pickup&quot; / &quot;Customer delivered&quot; with the job number. Crystal-company mail is always ignored. {s.inboxWatchGmailReady ? "Gmail is connected." : "Gmail is NOT connected yet (server settings needed)."}</p>
      </div>
      </>}
    </>
  );
  if (embedded) return <div data-testid="rotation-panel">{body}</div>;
  return (
    <main className="main-content" style={{ maxWidth: 1000 }}>
      <header className="topbar"><div><p className="eyebrow">ADMIN</p><h1>Settings</h1></div><Link className="btn" href="/user-menu" data-testid="page-exit">Admin Menu</Link></header>
      {body}
    </main>
  );
}

function RepRow({ rep, profiles, onSave }: { rep: Rep; profiles: S["profiles"]; onSave: (v: typeof blank) => void }) {
  const [v, setV] = useState({ name: rep.name, email: rep.email || "", phone: rep.phone || "", user_id: rep.user_id || "", is_active: rep.is_active, in_rotation: rep.in_rotation });
  return (
    <tr data-testid="rep-row">
      <td><input value={v.name} onChange={e => setV({ ...v, name: e.target.value })} /></td>
      <td><input value={v.email} onChange={e => setV({ ...v, email: e.target.value })} /></td>
      <td><input value={v.phone} placeholder="(blank)" onChange={e => setV({ ...v, phone: e.target.value })} /></td>
      <td><select value={v.user_id} onChange={e => setV({ ...v, user_id: e.target.value })}><option value="">—</option>{profiles.map(p => <option key={p.user_id} value={p.user_id}>{p.display_name}</option>)}</select></td>
      <td><input type="checkbox" checked={v.is_active} onChange={e => setV({ ...v, is_active: e.target.checked })} /></td>
      <td><input type="checkbox" checked={v.in_rotation} onChange={e => setV({ ...v, in_rotation: e.target.checked })} data-testid="rep-rotation" /></td>
      <td><button type="button" className="btn" onClick={() => onSave(v)}>Save</button></td>
    </tr>
  );
}
