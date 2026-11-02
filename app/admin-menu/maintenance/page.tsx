"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { addUser, deleteUser, inviteUser, listUsers, saveUser, type MaintUser } from "@/app/actions/maintenance";
import { USER_TYPE_LABEL, type UserType } from "@/lib/crm-constants";
import CompanyForm from "./company-form";
import LeadSourcesForm from "./lead-sources-form";
import PrioritiesForm from "./priorities-form";
import EmailCenterForm from "./email-center-form";
import SettingsPanel from "../settings/settings-panel";

type Tab = "users" | "invites" | "rotation" | "priorities" | "company" | "sources" | "email";
const TABS: { id: Tab; label: string }[] = [
  { id: "users", label: "Users" },
  { id: "invites", label: "User Invites" },
  { id: "rotation", label: "Lead Rotation" },
  { id: "priorities", label: "Priorities" },
  { id: "company", label: "Company Settings" },
  { id: "sources", label: "Lead Sources" },
  { id: "email", label: "Email Center" },
];

export default function MaintenancePage() {
  return <Suspense><Maintenance /></Suspense>;
}

function Maintenance() {
  const params = useSearchParams();
  const initial = params.get("tab");
  const [tab, setTab] = useState<Tab>(TABS.some(t => t.id === initial) ? (initial as Tab) : "users");
  return (
    <main className="main-content" style={{ maxWidth: 1100 }}>
      <header className="topbar">
        <div><p className="eyebrow">ADMIN MENU</p><h1>Maintenance</h1></div>
        <div className="btn-row"><Link className="btn" href="/user-menu" data-testid="page-exit">Admin Menu</Link></div>
      </header>
      <div className="tabs" role="tablist">
        {TABS.map(t => <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={`tab${tab === t.id ? " active" : ""}`} onClick={() => setTab(t.id)} data-testid={`tab-${t.id}`}>{t.label}</button>)}
      </div>
      {tab === "users" ? <Users key="users" /> : tab === "invites" ? <Users key="invites" invites /> : tab === "rotation" ? <SettingsPanel embedded /> : tab === "company" ? <CompanyForm /> : tab === "sources" ? <LeadSourcesForm /> : tab === "email" ? <EmailCenterForm /> : <PrioritiesForm />}
    </main>
  );
}

function Users({ invites = false }: { invites?: boolean }) {
  const [users, setUsers] = useState<MaintUser[] | null>(null);
  const [editing, setEditing] = useState<MaintUser | null>(null);
  const [adding, setAdding] = useState<"add" | "invite" | null>(null);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const load = useCallback(async () => { const r = await listUsers(); if (r.ok) setUsers(r.users); else setMsg({ text: r.error, error: true }); }, []);
  useEffect(() => { load(); }, [load]);
  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <h3 className="section-title" style={{ margin: 0 }}>{invites ? "User Invites" : "Users"}</h3>
        <div className="btn-row">
          {invites
            ? <button type="button" className="btn btn-primary" onClick={() => { setMsg(null); setAdding("invite"); }} data-testid="invite-user">Invite User</button>
            : <button type="button" className="btn btn-primary" onClick={() => { setMsg(null); setAdding("add"); }} data-testid="add-user">Add User</button>}
        </div>
      </div>
      {msg && <p className={`status-msg${msg.error ? " error" : ""}`} role="status">{msg.text}</p>}
      <table className="mini-table" data-testid="users-table">
        <thead><tr><th>Name</th><th>Username / login</th><th>Type</th><th>Phone</th><th>Email</th><th>Rotation</th><th>Active</th><th></th></tr></thead>
        <tbody>
          {(users || []).filter(u => !invites || u.invite_pending).map(u => (
            <tr key={u.user_id} style={u.is_active ? undefined : { opacity: 0.55 }} data-testid="user-row">
              <td><b>{u.display_name}</b>{u.invite_pending && <><br /><small className="muted" data-testid="invite-pending">Invite pending</small></>}</td>
              <td>{u.username}{u.login_email ? <><br /><small className="muted">{u.login_email}</small></> : null}</td>
              <td><span className="role-pill">{USER_TYPE_LABEL[u.role]}</span>{(u.role === "admin" || u.can_view_cards) && <><br /><small className="muted">Cards</small></>}</td>
              <td>{u.phone || <span className="muted">—</span>}</td>
              <td>{u.email || <span className="muted">—</span>}</td>
              <td>{u.in_rotation ? "On" : "Off"}</td>
              <td>{u.is_active ? "Yes" : "No"}</td>
              <td><button type="button" className="btn" onClick={() => { setMsg(null); setEditing(u); }} data-testid="edit-user">Edit</button></td>
            </tr>
          ))}
          {users && users.filter(u => !invites || u.invite_pending).length === 0 && <tr><td colSpan={8}>{invites ? "No pending invites. Use Invite User to email someone a CRM setup link." : "No users yet."}</td></tr>}
        </tbody>
      </table>
      {adding && <NewUser mode={adding} onClose={() => setAdding(null)} onDone={async text => { setAdding(null); setMsg({ text }); await load(); }} />}
      {editing && <EditUser user={editing} onClose={() => setEditing(null)} onSaved={async (text = "User saved.") => { setEditing(null); setMsg({ text }); await load(); }} />}
    </div>
  );
}

function EditUser({ user, onClose, onSaved }: { user: MaintUser; onClose: () => void; onSaved: (text?: string) => void }) {
  const [v, setV] = useState({ display_name: user.display_name, phone: user.phone, email: user.email, role: user.role, is_active: user.is_active, in_rotation: user.in_rotation, can_claim_unassigned: user.can_claim_unassigned, can_view_cards: user.can_view_cards, username: user.username, login_email: user.login_email, new_password: "" });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Edit user" onClick={onClose}>
      <form className="modal" data-testid="edit-user-form" onClick={e => e.stopPropagation()} onSubmit={async e => {
        e.preventDefault(); setSaving(true); setError("");
        const r = await saveUser(user.user_id, v);
        setSaving(false);
        if (r.ok) onSaved(); else setError(r.error);
      }}>
        <h3 className="section-title" style={{ marginTop: 0 }}>Edit user — {user.username || user.display_name}</h3>
        <div className="grid-2">
          <label className="field">Display name<input value={v.display_name} onChange={e => setV({ ...v, display_name: e.target.value })} required data-testid="edit-name" /></label>
          <label className="field">Type
            <select value={v.role} onChange={e => setV({ ...v, role: e.target.value as UserType })} data-testid="edit-role">
              {(Object.keys(USER_TYPE_LABEL) as UserType[]).map(t => <option key={t} value={t}>{USER_TYPE_LABEL[t]}</option>)}
            </select>
          </label>
          <label className="field">Username (User Login, case-sensitive)<input value={v.username} onChange={e => setV({ ...v, username: e.target.value })} data-testid="edit-username" /></label>
          <label className="field">Login email<input type="email" value={v.login_email} onChange={e => setV({ ...v, login_email: e.target.value })} data-testid="edit-login-email" /></label>
          <label className="field">New password (leave blank to keep)<input type="password" autoComplete="new-password" minLength={8} maxLength={72} value={v.new_password} onChange={e => setV({ ...v, new_password: e.target.value })} data-testid="edit-password" /></label>
          <label className="field">Phone (shown on this user&apos;s customer documents)<input value={v.phone} onChange={e => setV({ ...v, phone: e.target.value })} data-testid="edit-phone" /></label>
          <label className="field">Email (shown on this user&apos;s customer documents)<input type="email" value={v.email} onChange={e => setV({ ...v, email: e.target.value })} data-testid="edit-email" /></label>
        </div>
        <p className="muted" style={{ fontSize: 12, margin: "0 0 10px" }} data-testid="mailhost-note">Changing an email here only changes the CRM (login / documents / CC on customer mail). It does <b>not</b> create or change a your mail host mailbox: create or rename the mailbox in your mail host first. Customer emails always go out from support@fastbreakcrm.test.</p>
        <div style={{ display: "flex", gap: 22, flexWrap: "wrap", margin: "6px 0 12px", fontSize: 13, fontWeight: 600 }}>
          <label><input type="checkbox" checked={v.is_active} onChange={e => setV({ ...v, is_active: e.target.checked })} data-testid="edit-active" /> Active (uncheck to disable sign-in)</label>
          {v.role !== "admin" && <label><input type="checkbox" checked={v.can_view_cards} onChange={e => setV({ ...v, can_view_cards: e.target.checked })} data-testid="edit-cards" /> Can view cards</label>}
          <label><input type="checkbox" checked={v.in_rotation} onChange={e => setV({ ...v, in_rotation: e.target.checked })} data-testid="edit-rotation" /> In lead rotation</label>
          {v.role === "salesperson" && <label><input type="checkbox" checked={v.can_claim_unassigned} onChange={e => setV({ ...v, can_claim_unassigned: e.target.checked })} data-testid="edit-claim" /> Can take leads from Assign New Estimates</label>}
        </div>
        <p className="muted" style={{ fontSize: 12, margin: "0 0 10px" }}>Salesman: own leads only. Supervisor: sees all leads, no Maintenance. Admin: sees all, plus Maintenance. Disable keeps their history; Delete removes the login permanently.</p>
        {error && <p className="status-msg error" role="alert">{error}</p>}
        <div className="btn-row">
          <button type="submit" className="btn btn-primary" disabled={saving} data-testid="edit-save">{saving ? "Saving…" : "Save"}</button>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-danger" style={{ marginLeft: "auto" }} disabled={saving} data-testid="delete-user" onClick={async () => {
            if (!window.confirm(`Permanently delete ${user.display_name || user.username}? This removes their login. To keep their history, uncheck Active instead.`)) return;
            setSaving(true); setError("");
            const r = await deleteUser(user.user_id);
            setSaving(false);
            if (r.ok) onSaved("User deleted."); else setError(r.error);
          }}>Delete user</button>
        </div>
      </form>
    </div>
  );
}

function NewUser({ mode, onClose, onDone }: { mode: "add" | "invite"; onClose: () => void; onDone: (text: string) => void }) {
  const [v, setV] = useState({ display_name: "", email: "", username: "", password: "", phone: "", role: "salesperson" as UserType, can_view_cards: false, can_claim_unassigned: false, is_active: true, send_welcome: true });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const invite = mode === "invite";
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={invite ? "Invite user" : "Add user"} onClick={onClose}>
      <form className="modal" data-testid="new-user-form" onClick={e => e.stopPropagation()} onSubmit={async e => {
        e.preventDefault(); setSaving(true); setError("");
        const r = invite ? await inviteUser(v) : await addUser(v);
        setSaving(false);
        if (!r.ok) { setError(r.error); return; }
        onDone(invite
          ? (r.mailed ? `Invitation emailed to ${v.email} (CRM URL, Network ID/Password, setup link). They show below as "Invite pending" until they set their username & password.` : `Invite created, but the CRM welcome email failed — Supabase sent its setup link only. Share the CRM URL and Network ID/Password with ${v.email} yourself.`)
          : (r.mailed ? "User created and welcome email sent." : "User created. They can sign in now with their username (or email) and the password you set."));
      }}>
        <h3 className="section-title" style={{ marginTop: 0 }}>{invite ? "Invite user" : "Add user"}</h3>
        <p className="muted" style={{ fontSize: 12, margin: "0 0 10px" }}>{invite
          ? "Sends one email from the CRM with the CRM URL, Network ID + Password, sign-in steps, and a secure link where they choose their username and password."
          : "Creates the login now. Username defaults to the email if left blank."}</p>
        <div className="grid-2">
          <label className="field">Display name<input value={v.display_name} onChange={e => setV({ ...v, display_name: e.target.value })} required maxLength={120} data-testid="new-name" /></label>
          <label className="field">Email<input type="email" value={v.email} onChange={e => setV({ ...v, email: e.target.value })} required maxLength={254} data-testid="new-email" /></label>
          {!invite && <label className="field">Username (optional)<input value={v.username} onChange={e => setV({ ...v, username: e.target.value })} maxLength={80} placeholder="defaults to email" data-testid="new-username" /></label>}
          {!invite && <label className="field">Password (8+ characters)<input type="password" autoComplete="new-password" value={v.password} onChange={e => setV({ ...v, password: e.target.value })} required minLength={8} maxLength={72} data-testid="new-password" /></label>}
          <label className="field">Phone<input value={v.phone} onChange={e => setV({ ...v, phone: e.target.value })} maxLength={20} placeholder="954-555-0100" data-testid="new-phone" /></label>
          <label className="field">Type
            <select value={v.role} onChange={e => setV({ ...v, role: e.target.value as UserType })} data-testid="new-role">
              {(Object.keys(USER_TYPE_LABEL) as UserType[]).map(t => <option key={t} value={t}>{USER_TYPE_LABEL[t]}</option>)}
            </select>
          </label>
        </div>
        <div style={{ display: "flex", gap: 22, flexWrap: "wrap", margin: "6px 0 12px", fontSize: 13, fontWeight: 600 }}>
          {v.role !== "admin" && <label><input type="checkbox" checked={v.can_view_cards} onChange={e => setV({ ...v, can_view_cards: e.target.checked })} data-testid="new-cards" /> Can view cards</label>}
          {v.role === "salesperson" && <label><input type="checkbox" checked={v.can_claim_unassigned} onChange={e => setV({ ...v, can_claim_unassigned: e.target.checked })} data-testid="new-claim" /> Can take leads from Assign New Estimates</label>}
          {!invite && <label><input type="checkbox" checked={v.is_active} onChange={e => setV({ ...v, is_active: e.target.checked })} data-testid="new-active" /> Active</label>}
          {!invite && <label><input type="checkbox" checked={v.send_welcome} onChange={e => setV({ ...v, send_welcome: e.target.checked })} data-testid="new-welcome" /> Email them CRM URL + Network ID/Password + login</label>}
        </div>
        {error && <p className="status-msg error" role="alert">{error}</p>}
        <div className="btn-row">
          <button type="submit" className="btn btn-primary" disabled={saving} data-testid="new-save">{saving ? (invite ? "Sending…" : "Creating…") : (invite ? "Send invitation" : "Create user")}</button>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </div>
  );
}
