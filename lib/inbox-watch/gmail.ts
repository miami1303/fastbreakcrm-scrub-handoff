import "server-only";
// Minimal Gmail REST client for the in-CRM inbox watch. Uses the CRM's OWN Google OAuth client
// (not the Grok Bot connector). Read-only scope: https://www.googleapis.com/auth/gmail.readonly
//   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GMAIL_REFRESH_TOKEN  (refresh token for the company Gmail inbox)
//   GMAIL_USER (optional, default "me")
import type { InboxMessage } from "./classify";

export function gmailConfigured(env = process.env): boolean {
  return !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.GMAIL_REFRESH_TOKEN);
}

async function accessToken(): Promise<string> {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID || "", client_secret: process.env.GOOGLE_CLIENT_SECRET || "",
      refresh_token: process.env.GMAIL_REFRESH_TOKEN || "", grant_type: "refresh_token",
    }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error(`Gmail token refresh failed (${r.status}).`);
  return j.access_token as string;
}

type Part = { mimeType?: string; body?: { data?: string }; parts?: Part[]; headers?: { name: string; value: string }[] };
const b64 = (s: string) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
const stripHtml = (h: string) => h.replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, " ").replace(/<br\s*\/?>|<\/p>|<\/div>|<\/tr>/gi, "\n").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#36;/g, "$").replace(/[ \t]+/g, " ");

function bodyText(p: Part): string {
  const plain: string[] = []; const html: string[] = [];
  const walk = (x: Part) => {
    if (x.body?.data && x.mimeType === "text/plain") plain.push(b64(x.body.data));
    else if (x.body?.data && x.mimeType === "text/html") html.push(stripHtml(b64(x.body.data)));
    (x.parts || []).forEach(walk);
  };
  walk(p);
  return (plain.length ? plain : html).join("\n").slice(0, 20000);
}

export async function fetchRecentMessages(query: string, max = 25): Promise<InboxMessage[]> {
  const token = await accessToken();
  const user = encodeURIComponent(process.env.GMAIL_USER || "me");
  const api = `https://gmail.googleapis.com/gmail/v1/users/${user}`;
  const h = { authorization: `Bearer ${token}` };
  const list = await fetch(`${api}/messages?maxResults=${max}&q=${encodeURIComponent(query)}`, { headers: h });
  if (!list.ok) throw new Error(`Gmail list failed (${list.status}).`);
  const ids: { id: string }[] = (await list.json()).messages || [];
  const out: InboxMessage[] = [];
  for (const { id } of ids) {
    const r = await fetch(`${api}/messages/${id}?format=full`, { headers: h });
    if (!r.ok) continue;
    const m = await r.json();
    const hdr = (n: string) => (m.payload?.headers || []).filter((x: { name: string }) => x.name.toLowerCase() === n).map((x: { value: string }) => x.value).join(", ");
    out.push({ id, from: hdr("from"), to: [hdr("to"), hdr("delivered-to"), hdr("cc")].filter(Boolean).join(", "), subject: hdr("subject"), body: bodyText(m.payload || {}) || String(m.snippet || ""), labels: m.labelIds || [] });
  }
  return out;
}
