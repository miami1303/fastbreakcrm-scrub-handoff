// TEST ONLY: local stand-in for the Supabase HTTP surface the CRM uses, on one port.
//   /rest/v1/*            -> real PostgREST (against the throwaway Postgres)
//   /auth/v1/*            -> minimal fake GoTrue (password login, getUser, admin listUsers)
//   /realtime/v1/websocket -> minimal Phoenix-protocol fake of Supabase Realtime
//                             (postgres_changes from LISTEN/NOTIFY; mimics the RLS rule
//                              that a user only receives their own crm_notifications rows)
// It is not Supabase; it exists so the end-to-end flow can run with no network/secrets.
import http from "node:http";
import crypto from "node:crypto";
import { writeFileSync } from "node:fs";
import pg from "pg";
import { WebSocketServer } from "ws";

const PORT = Number(process.env.STACK_PORT || 54321);
const PGRST = process.env.PGRST_URL || "http://127.0.0.1:3001";
const SECRET = process.env.JWT_SECRET;
const DB = process.env.DATABASE_URL;
const b64u = (b) => Buffer.from(b).toString("base64url");
function sign(claims) {
  const h = b64u(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const p = b64u(JSON.stringify(claims));
  return `${h}.${p}.${crypto.createHmac("sha256", SECRET).update(`${h}.${p}`).digest("base64url")}`;
}
function verify(token) {
  try {
    const [h, p, s] = String(token || "").split(".");
    if (crypto.createHmac("sha256", SECRET).update(`${h}.${p}`).digest("base64url") !== s) return null;
    const c = JSON.parse(Buffer.from(p, "base64url").toString());
    if (c.exp && c.exp < Date.now() / 1000) return null;
    return c;
  } catch { return null; }
}
const now = () => Math.floor(Date.now() / 1000);
const ANON = sign({ role: "anon", iss: "local-test", iat: now(), exp: now() + 86400 * 30 });
const SERVICE = sign({ role: "service_role", iss: "local-test", iat: now(), exp: now() + 86400 * 30 });
writeFileSync(process.env.KEYS_FILE || "/tmp/crm-e2e-keys.env", `NEXT_PUBLIC_SUPABASE_ANON_KEY=${ANON}\nSUPABASE_SERVICE_ROLE_KEY=${SERVICE}\n`);

const pool = new pg.Pool({ connectionString: DB });
const refresh = new Map();
const userJson = (u) => ({ id: u.id, aud: "authenticated", role: "authenticated", email: u.email, app_metadata: { provider: "email" }, user_metadata: {}, created_at: u.created_at });
function session(u) {
  const access = sign({ sub: u.id, role: "authenticated", aud: "authenticated", email: u.email, iat: now(), exp: now() + 3600, session_id: crypto.randomUUID() });
  const rt = crypto.randomBytes(16).toString("hex");
  refresh.set(rt, u);
  return { access_token: access, token_type: "bearer", expires_in: 3600, expires_at: now() + 3600, refresh_token: rt, user: userJson(u) };
}
const send = (res, code, body, headers = {}) => { res.writeHead(code, { "content-type": "application/json", "access-control-allow-origin": "*", ...headers }); res.end(body === undefined ? "" : JSON.stringify(body)); };
const readBody = (req) => new Promise((r) => { let d = ""; req.on("data", (c) => (d += c)); req.on("end", () => r(d)); });

async function auth(req, res, url) {
  const path = url.pathname.replace(/^\/auth\/v1/, "");
  const bearer = (req.headers.authorization || "").replace(/^Bearer /i, "");
  if (req.method === "OPTIONS") return send(res, 204, undefined, { "access-control-allow-headers": "*", "access-control-allow-methods": "*" });
  if (path === "/token") {
    const body = JSON.parse((await readBody(req)) || "{}");
    if (url.searchParams.get("grant_type") === "password") {
      const { rows } = await pool.query("select id, email, created_at from auth.users where email = $1 and encrypted_password = crypt($2, encrypted_password)", [body.email, body.password]);
      if (!rows[0]) return send(res, 400, { error: "invalid_grant", error_description: "Invalid login credentials", code: "invalid_credentials", msg: "Invalid login credentials" });
      return send(res, 200, session(rows[0]));
    }
    const u = refresh.get(body.refresh_token);
    if (!u) return send(res, 400, { error: "invalid_grant", msg: "Invalid Refresh Token" });
    return send(res, 200, session(u));
  }
  if (path === "/user") {
    const c = verify(bearer);
    if (!c?.sub) return send(res, 401, { code: 401, msg: "invalid JWT" });
    const { rows } = await pool.query("select id, email, created_at from auth.users where id = $1", [c.sub]);
    return rows[0] ? send(res, 200, userJson(rows[0])) : send(res, 404, { msg: "User not found" });
  }
  if (path === "/logout") return send(res, 204);
  if (path === "/admin/users") {
    if (verify(bearer)?.role !== "service_role") return send(res, 401, { msg: "service role required" });
    const { rows } = await pool.query("select id, email, created_at from auth.users order by created_at");
    return send(res, 200, { users: rows.map(userJson), aud: "authenticated" }, { "x-total-count": String(rows.length) });
  }
  const one = /^\/admin\/users\/([0-9a-f-]{36})$/.exec(path);
  if (one) {
    if (verify(bearer)?.role !== "service_role") return send(res, 401, { msg: "service role required" });
    const { rows } = await pool.query("select id, email, created_at from auth.users where id = $1", [one[1]]);
    return rows[0] ? send(res, 200, userJson(rows[0])) : send(res, 404, { msg: "User not found" });
  }
  return send(res, 404, { msg: `fake auth: ${path} not implemented` });
}

function proxy(req, res, url) {
  const target = new URL(url.pathname.replace(/^\/rest\/v1/, "") + url.search, PGRST);
  const p = http.request(target, { method: req.method, headers: { ...req.headers, host: target.host } }, (r) => {
    res.writeHead(r.statusCode, { ...r.headers, "access-control-allow-origin": "*" });
    r.pipe(res);
  });
  p.on("error", (e) => send(res, 502, { message: e.message }));
  req.pipe(p);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname.startsWith("/auth/v1")) return auth(req, res, url).catch((e) => send(res, 500, { msg: e.message }));
  if (url.pathname.startsWith("/rest/v1")) return proxy(req, res, url);
  send(res, 404, { msg: "not found" });
});

// ---- fake Realtime ----
const wss = new WebSocketServer({ noServer: true });
const subs = new Set(); // {ws, topic, user, bindings:[{id,event,schema,table,filter}]}
let bindingId = 1;
server.on("upgrade", (req, socket, head) => {
  if (!req.url.startsWith("/realtime/v1/websocket")) return socket.destroy();
  wss.handleUpgrade(req, socket, head, (ws) => {
    ws.on("message", (raw) => {
      let m; try { m = JSON.parse(raw); } catch { return; }
      // Phoenix serializer v2 (current supabase-js) sends arrays: [join_ref, ref, topic, event, payload].
      const v2 = Array.isArray(m);
      if (v2) m = { join_ref: m[0], ref: m[1], topic: m[2], event: m[3], payload: m[4] };
      ws.v2 = ws.v2 || v2;
      const reply = (response = {}) => ws.send(JSON.stringify(v2
        ? [m.join_ref, m.ref, m.topic, "phx_reply", { status: "ok", response }]
        : { topic: m.topic, event: "phx_reply", payload: { status: "ok", response }, ref: m.ref, join_ref: m.join_ref }));
      if (m.topic === "phoenix" && m.event === "heartbeat") return reply();
      if (m.event === "phx_join") {
        const claims = verify(m.payload?.access_token) || {};
        const bindings = (m.payload?.config?.postgres_changes || []).map((b) => ({ id: bindingId++, ...b }));
        subs.add({ ws, topic: m.topic, user: claims.sub || null, joinRef: m.join_ref || m.ref, bindings });
        return reply({ postgres_changes: bindings });
      }
      if (m.event === "access_token") {
        const claims = verify(m.payload?.access_token) || {};
        for (const s of subs) if (s.ws === ws && s.topic === m.topic) s.user = claims.sub || s.user;
        return reply();
      }
      if (m.event === "phx_leave") { for (const s of [...subs]) if (s.ws === ws && s.topic === m.topic) subs.delete(s); return reply(); }
      reply();
    });
    ws.on("close", () => { for (const s of [...subs]) if (s.ws === ws) subs.delete(s); });
  });
});
function matches(b, ch) {
  if (b.schema && b.schema !== "public") return false;
  if (b.table && b.table !== ch.table) return false;
  if (b.event && b.event !== "*" && b.event !== ch.type) return false;
  if (b.filter) {
    const m = /^(\w+)=eq\.(.+)$/.exec(b.filter);
    if (m && String(ch.record?.[m[1]]) !== m[2]) return false;
  }
  return true;
}
const listener = new pg.Client({ connectionString: DB });
await listener.connect();
await listener.query("listen realtime");
listener.on("notification", (n) => {
  const ch = JSON.parse(n.payload);
  for (const s of subs) {
    if (ch.table === "crm_notifications" && ch.record.user_id !== s.user) continue; // RLS: own rows only
    const ids = s.bindings.filter((b) => matches(b, ch)).map((b) => b.id);
    if (!ids.length) continue;
    const payload = { ids, data: { schema: "public", table: ch.table, commit_timestamp: ch.commit_timestamp, type: ch.type, record: ch.record, old_record: null, columns: [], errors: null } };
    s.ws.send(JSON.stringify(s.ws.v2
      ? [s.joinRef, null, s.topic, "postgres_changes", payload]
      : { topic: s.topic, event: "postgres_changes", ref: null, join_ref: s.joinRef, payload }));
  }
});
server.listen(PORT, "127.0.0.1", () => console.log(`[stack] listening on ${PORT}`));
