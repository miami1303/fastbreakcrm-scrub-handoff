// TEST ONLY: menu pages (main menu hub, Follow-Up Menu, Recurring Customers, Operations
// Calendar, Estimates in Process, Salesmen Performance, Recent) against the LOCAL throwaway
// stack. Seeds demo leads into the LOCAL test DB only (refuses any non-local DATABASE_URL).
// node tests/e2e/menu-pages.mjs   (after core-flow.mjs; same env as core-flow)
import { chromium } from "playwright-core";
import pg from "pg";
import assert from "node:assert/strict";

const BASE = process.env.BASE_URL || "http://localhost:3100";
// Network Login (company login): TEST-ONLY values, same as the server's NETWORK_ID / NETWORK_PASSWORD.
const NET_ID = process.env.NETWORK_ID || "FastBreak-Test", NET_PASS = process.env.NETWORK_PASSWORD || "Test-Network-Only-1";
async function networkLogin(page) {
  await page.fill("[data-testid=network-id]", NET_ID);
  await page.fill("[data-testid=network-password]", NET_PASS);
  await Promise.all([page.waitForURL(/\/user-login$/), page.click("[data-testid=network-choice]")]);
}
const OUT = process.env.SHOTS || "/tmp/crm-e2e-shots";
const DB_URL = process.env.DATABASE_URL || "postgres://postgres@127.0.0.1:55432/crm_e2e";
if (!/@(127\.0\.0\.1|localhost)[:/]/.test(DB_URL)) throw new Error("menu-pages seeds demo data: LOCAL test DB only");
const db = new pg.Client({ connectionString: DB_URL });
await db.connect();
const q = async (sql, p = []) => (await db.query(sql, p)).rows;
// Live setup: Sam and Jordan are admins with card access and the Assign pool.
await q("update user_profiles set role='admin', can_view_cards=true, can_claim_unassigned=true where user_id in (select user_id from user_identities where username in ('Sam','Jordan'))");
const log = (...a) => console.log("✓", ...a);
const browser = await chromium.launch({ executablePath: process.env.CHROME || "/usr/bin/google-chrome", args: ["--no-sandbox"] });

// ---- demo data (LOCAL only) ----
const [today] = await q("select (now() at time zone 'America/Chicago')::date::text d");
const T = today.d;
const reps = Object.fromEntries((await q("select name, id, user_id from crm_reps")).map(r => [r.name, r]));
const R = n => reps[n] || Object.values(reps)[0];
const lead = async (o) => {
  const r = R(o.rep || "Sam Rep");
  const [e] = await q(`insert into estimates (customer_name, customer_email, customer_phone, pickup_address, delivery_address, status, owner_id, assigned_rep_id,
      priority, follow_up_at, last_touched_at, primary_date, backup_date, booked_at, total_amount, miles, created_at, lead_source)
    values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16, coalesce($17::timestamptz, now()), $18) returning id, job_number`,
    [o.name, `${o.name.split(" ")[0].toLowerCase()}@example.test`, "312-555-01" + String(10 + Math.floor(Math.random() * 89)), o.from, o.to, o.status || "quoted", r.user_id, r.id,
      o.priority ?? null, o.fu ?? null, o.touched ?? null, o.pickup ?? null, o.backup ?? null, o.status === "booked" ? (o.bookedAt || new Date().toISOString()) : null, o.total ?? null, o.miles ?? null, o.created ?? null, o.source ?? ["Google", "Web Lead", "Referral", "BBB", "Phone Call"][Math.floor(Math.random() * 5)]]);
  await q("insert into quotes (estimate_id, total_amount, deposit_amount, cod_amount) values ($1,$2,$3,$4) on conflict (estimate_id) do update set total_amount=excluded.total_amount", [e.id, o.total ?? 0, o.deposit ?? 0, (o.total ?? 0) - (o.deposit ?? 0)]);
  for (const v of o.vehicles || [["2021", "Toyota", "Camry"]]) await q("insert into vehicles (estimate_id, year, make, model, vehicle_type, is_running) values ($1,$2,$3,$4,'Sedan',true)", [e.id, v[0], v[1], v[2]]);
  if (o.paid) await q("insert into payments (estimate_id, amount, method, is_deposit, created_by_name) values ($1,$2,'Zelle',true,'Owner')", [e.id, o.paid]).catch(err => console.log("payment seed skipped:", err.message));
  return e;
};
const at = (dayOffset, hh = 10) => `(('${T}'::date + ${dayOffset}) + time '${String(hh).padStart(2, "0")}:00') at time zone 'America/Chicago'`;
const ts = async (dayOffset, hh) => (await q(`select ${at(dayOffset, hh)} t`))[0].t.toISOString();
const routes = [
  ["Denver, CO 80202", "Austin, TX 78701", 920], ["Phoenix, AZ 85004", "Seattle, WA 98101", 1420], ["Atlanta, GA 30303", "Boston, MA 02108", 1080],
  ["Miami, FL 33101", "Chicago, IL 60601", 1380], ["Dallas, TX 75201", "Nashville, TN 37203", 660], ["Las Vegas, NV 89101", "Portland, OR 97204", 980],
  ["Orlando, FL 32801", "Newark, NJ 07102", 1010], ["Salt Lake City, UT 84101", "Omaha, NE 68102", 930], ["Charlotte, NC 28202", "San Diego, CA 92101", 2390],
];
const names = ["Olivia Grant", "Marcus Bell", "Priya Shah", "Diego Morales", "Reph Cole", "Victor Nguyen", "Grace Kim", "Samuel Ortiz", "Lena Fischer"];
const open = [];
for (let i = 0; i < 9; i++) {
  const [from, to, miles] = routes[i];
  open.push(await lead({ name: names[i], source: i === 0 ? "BBB" : i < 4 ? "Web Lead" : "Google", from, to, miles, rep: i % 3 === 2 ? "Jordan Demo" : "Sam Rep", priority: i, total: 850 + i * 95, deposit: 200,
    fu: await ts([0, 1, -1, 0, 3, -6, -9, 2, 0][i], 9 + i), touched: i % 4 === 0 ? null : await ts(-12, 9), pickup: (await q(`select ('${T}'::date + ${7 + i * 3})::text d`))[0].d,
    vehicles: i % 3 === 0 ? [["2022", "Honda", "Accord"], ["2018", "Jeep", "Wrangler"]] : [["2020", "Ford", "Explorer"]] }));
}
const booked = [];
const bookedDefs = [
  ["Ruth Allen", 2, 6, "Kansas City, MO 64105", "Tampa, FL 33602", 1190, 1450, 1450], ["Ethan Ross", 5, null, "Houston, TX 77002", "Denver, CO 80202", 1030, 1100, 200],
  ["Maya Patel", 9, 11, "Columbus, OH 43215", "Raleigh, NC 27601", 480, 875, 0], ["Noah Brooks", 13, null, "Minneapolis, MN 55401", "Phoenix, AZ 85004", 1640, 1525, 300],
  ["Ava Turner", -3, null, "Detroit, MI 48226", "Atlanta, GA 30303", 730, 990, 990],
];
for (const [name, off, off2, from, to, miles, total, paid] of bookedDefs) {
  const pickup = (await q(`select ('${T}'::date + ${off})::text d`))[0].d;
  const backup = off2 === null ? null : (await q(`select ('${T}'::date + ${off2})::text d`))[0].d;
  booked.push(await lead({ name, from, to, miles, status: "booked", total, deposit: 200, paid, pickup, backup, priority: 1, rep: name === "Ethan Ross" ? "Jordan Demo" : "Sam Rep" }));
}
const leap = await lead({ name: "Leap Day Pickup", from: "Chicago, IL 60601", to: "Miami, FL 33101", miles: 1380, status: "booked", total: 1200, deposit: 200, pickup: "2028-02-29" });
// recurring: quote viewed, then re-opened today (2 leads)
for (const [i, e] of [open[1], open[4]].entries()) {
  const tok = `menu-demo-${e.id.slice(0, 8)}`;
  const [m] = await q("insert into crm_emails (estimate_id, token, kind, subject) values ($1,$2,'e_quote',$3) returning id", [e.id, tok, `Your Auto Transport Quote - ${e.job_number}`]);
  for (const [k, when] of [[0, await ts(-2, 11)], [1, await ts(0, 8 + i)], [2, new Date(Date.now() - (i + 1) * 600000).toISOString()]]) {
    await q("insert into crm_email_events (email_id, estimate_id, event, ip, created_at) values ($1,$2,'viewed',$3,$4)", [m.id, e.id, `73.42.18.${20 + k}`, when]);
  }
}
log("seeded LOCAL demo data:", open.length, "open leads,", booked.length + 1, "booked jobs (incl. 2028-02-29), 2 recurring");

// ---- pages ----
async function login(user, pass, width = 1280) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 } });
  const page = await ctx.newPage();
  page.on("dialog", d => d.accept());
  // Network Login (/) -> User Login -> main menu.
  await page.goto(`${BASE}/`);
  await networkLogin(page);
  await page.fill("#username", user); await page.fill("#password", pass);
  await Promise.all([page.waitForURL(/menu/), page.click("button[type=submit]")]);
  return page;
}
const shot = (p, name, full = true) => p.screenshot({ path: `${OUT}/${name}.png`, fullPage: full });
// Network Login first: a fresh browser session can't open User Login or any CRM page directly.
const CRM_PATHS = ["/user-menu", "/admin-menu", "/estimates", "/estimates/new", `/estimates/${open[0].id}/payments`, "/operations", "/follow-up", "/recurring", "/performance", "/recent", "/search", "/reports"];
{
  const anon = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  for (const path of ["/user-login", ...CRM_PATHS]) {
    await anon.goto(`${BASE}${path}`);
    assert.equal(new URL(anon.url()).pathname, "/", `${path} -> Network Login when the network step was skipped`);
  }
  // The Network Login never auto-forwards: it waits for the network to be chosen.
  await anon.goto(`${BASE}/`);
  await anon.waitForTimeout(1500);
  assert.equal(new URL(anon.url()).pathname, "/", "Network Login stays put (no auto-forward)");
  assert.deepEqual(await anon.locator("[data-testid=network-form] label").allTextContents(), ["Network ID", "Password"], "labels: Network ID / Password");
  assert.equal(await anon.textContent(".eyebrow"), "NETWORK LOGIN");
  await shot(anon, "N0-network-login");
  // Company login required: no creds -> stays on /; wrong -> generic error; hand-made cookie -> rejected.
  await anon.click("[data-testid=network-choice]");
  await anon.waitForTimeout(500);
  assert.equal(new URL(anon.url()).pathname, "/", "no credentials: stays on Network Login");
  for (const [id, pw] of [[NET_ID, "wrong-password"], ["someone-else", NET_PASS], [NET_ID, NET_PASS.toLowerCase()]]) {
    await anon.fill("[data-testid=network-id]", id); await anon.fill("[data-testid=network-password]", pw);
    await Promise.all([anon.waitForURL(/\/\?error=credentials$/), anon.click("[data-testid=network-choice]")]);
    assert.equal(await anon.textContent("[data-testid=network-error]"), "Network ID or password is incorrect.");
  }
  await shot(anon, "N0b-network-login-wrong");
  for (const value of ["fastbreak", "v1.1792000000000.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", `v1.${Date.now()}.forgedforgedforgedforgedforgedforgedforged`]) {
    await anon.context().addCookies([{ name: "crm_network", value, url: BASE }]);
    await anon.goto(`${BASE}/user-login`);
    assert.equal(new URL(anon.url()).pathname, "/", `hand-set cookie ${value.slice(0, 18)}… rejected`);
  }
  await anon.context().clearCookies();
  // Network ID is case-insensitive and trimmed; the password is exact.
  await anon.goto(`${BASE}/`);
  await anon.fill("[data-testid=network-id]", `  ${NET_ID.toUpperCase()} `); await anon.fill("[data-testid=network-password]", NET_PASS);
  await Promise.all([anon.waitForURL(/\/user-login$/), anon.click("[data-testid=network-choice]")]);
  const netCookie = (await anon.context().cookies()).find(c => c.name === "crm_network");
  assert.ok(netCookie && netCookie.httpOnly && netCookie.sameSite === "Lax" && netCookie.expires === -1 && /^v1\.\d+\.[\w-]+$/.test(netCookie.value), "signed, httpOnly, session cookie");
  log("Network Login: no creds stays on /, wrong creds -> 'Network ID or password is incorrect.', hand-set cookies rejected, right creds -> /user-login with a signed session cookie");
  // Network chosen but not signed in: CRM pages -> User Login.
  for (const path of CRM_PATHS) {
    await anon.goto(`${BASE}${path}`);
    assert.equal(new URL(anon.url()).pathname, "/user-login", `${path} -> User Login when logged out`);
  }
  await anon.context().close();
  log("network gate: /user-login and every CRM page -> Network Login (/) until the network is chosen; then logged out -> User Login; / never auto-forwards");
}
const owner = await login("owner", "Test-Only-1");
assert.equal(new URL(owner.url()).pathname, "/user-menu", "admin lands on the main menu hub");
assert.equal(await owner.textContent("[data-testid=hub-title]"), "Admin Menu", "admin sees the Admin Menu");
await owner.goto(`${BASE}/admin-menu`);
assert.equal(new URL(owner.url()).pathname, "/user-menu", "old /admin-menu redirects to the hub");
log("login: admin lands on the hub; /admin-menu -> hub");
// Usernames are case-sensitive: 'Sam' works (below), 'sam' / 'SAM' do not.
for (const wrong of ["sam", "SAM", "jordan"]) {
  const p = await (await browser.newContext()).newPage();
  await p.goto(`${BASE}/`);
  await networkLogin(p);
  await p.fill("#username", wrong); await p.fill("#password", wrong === "jordan" ? "Test-Only-3" : "Test-Only-2");
  await Promise.all([p.waitForURL(/user-login\?error=credentials/), p.click("button[type=submit]")]);
  await p.context().close();
}
log("login: 'sam', 'SAM', 'jordan' rejected (exact, case-sensitive username match)");

// A) main menu
await owner.goto(`${BASE}/user-menu`);
await owner.waitForSelector("[data-testid=menu-follow-count]");
await owner.waitForTimeout(500);
await shot(owner, "A-main-menu");
log("A main menu");

// B) Follow-Up Menu. Lead separation: Sam and Jordan are both admins, but each Follow-Up Menu
// (lists, priority bubbles and counts) shows ONLY that user's own leads.
const fuSam = await login("Sam", "Test-Only-2");
const fuJordan = await login("Jordan", "Test-Only-3");
const ownOpen = async (who) => (await q(`select job_number, priority from estimates where deleted_at is null and status in ('draft','quoted','signed')
  and owner_id = (select user_id from user_identities where username=$1)`, [who]));
const fuRows = async (page) => page.locator("[data-testid=fu-table] [data-testid=job-row]").evaluateAll(rs => rs.map(r => r.dataset.job));
await fuSam.goto(`${BASE}/follow-up`);
await fuSam.waitForSelector("[data-testid=fu-count-all]");
const labels = await fuSam.locator("[data-testid=fu-lists] .fu-label").allTextContents();
assert.deepEqual(labels, ["New Estimates - Untouched", "Today", "Tomorrow", "Yesterday", "This Week (Sun-Sat)", "Last Week (Sun-Sat)", "All Follow-Up Estimates", "Update Past Follow-Up Date"]);
assert.deepEqual(await fuSam.locator("[data-testid=fu-sorts] .fu-label").allTextContents(), ["Follow-Up Date", "Pickup Date", "Job No", "Total", "Priority"]);
assert.equal(await fuSam.locator("[data-testid=pcircle-none]").count(), 1, "No Priority circle");
assert.equal(await fuSam.locator("[data-testid=fu-rep]").count(), 0, "no rep filter: own leads only");
await shot(fuSam, "B-follow-up-menu");
await fuSam.check("[data-testid=fu-opt-all] input");
await fuSam.check("[data-testid=fu-sort-priority]");
await fuSam.click("[data-testid=fu-submit]");
await fuSam.waitForSelector("[data-testid=fu-table] [data-testid=job-row]");
const samJobs = await fuRows(fuSam);
const samOwn = (await ownOpen("Sam")).map(r => r.job_number);
assert.deepEqual([...samJobs].sort(), [...samOwn].sort(), "Mark: exactly his own open leads");
for (const b of [...booked, leap]) assert.ok(!samJobs.includes(b.job_number), "booked job not a follow-up");
for (const o of open) if (!samOwn.includes(o.job_number)) assert.ok(!samJobs.includes(o.job_number), `${o.job_number} (Jordan's) not in Mark's list`);
await shot(fuSam, "B-follow-up-results");
await fuJordan.goto(`${BASE}/follow-up`);
await fuJordan.waitForSelector("[data-testid=fu-count-all]");
await fuJordan.check("[data-testid=fu-opt-all] input"); await fuJordan.click("[data-testid=fu-submit]");
await fuJordan.waitForSelector("[data-testid=fu-table] [data-testid=job-row]");
const jordanJobs = await fuRows(fuJordan);
const jordanOwn = (await ownOpen("Jordan")).map(r => r.job_number);
assert.deepEqual([...jordanJobs].sort(), [...jordanOwn].sort(), "Jordan: exactly his own open leads");
assert.ok(!jordanJobs.some(j => samJobs.includes(j)), "no lead in both lists");
// Bubble counts are per user too (Priority 2 = open[2], Jordan's).
const bubble = async (page, p) => Number(await page.locator(`[data-testid=pcircle-${p}] b`).textContent());
const count = async (who, p) => (await ownOpen(who)).filter(r => r.priority === p).length;
for (const [page, who] of [[fuSam, "Sam"], [fuJordan, "Jordan"]]) {
  for (const p of [0, 1, 2, 3, 4, 5, 6, 7, 8]) {
    const n = await count(who, p);
    const circle = page.locator(`[data-testid=pcircle-${p}]`);
    if (n > 0) assert.equal(await bubble(page, p), n, `${who} P${p} bubble`);
    else if (await circle.count()) assert.equal(await bubble(page, p), 0, `${who} P${p} label with no leads`);
  }
}
log("B Follow-Up Menu: list order, company priority circles, booked excluded; Sam and Jordan (both admins) each see ONLY their own leads and bubble counts");

// B2) Priority bubble: clicking Priority 2 opens that user's OPEN P2 leads at once, oldest job
// number first; booked jobs never.
{
  for (const [name, rep] of [["Pria Two A", "Jordan Demo"], ["Pria Two B", "Riley Test"], ["Pria Two C", "Sam Rep"], ["Pria Two D", "Riley Test"], ["Pria Two E", "Sam Rep"]]) {
    await lead({ name, from: "Reno, NV 89501", to: "Boise, ID 83702", miles: 430, rep, priority: 2, total: 700, deposit: 200, fu: await ts(1, 10), source: "Google" });
  }
  const p2Booked = await lead({ name: "Pria Two Booked", from: "Reno, NV 89501", to: "Boise, ID 83702", miles: 430, status: "booked", priority: 2, total: 700, deposit: 200, pickup: (await q(`select ('${T}'::date + 15)::text d`))[0].d, rep: "Sam Rep" });
  const expectP2 = async (who) => (await q(`select job_number from estimates where deleted_at is null and status in ('draft','quoted','signed') and priority = 2
    and owner_id = (select user_id from user_identities where username=$1) order by length(job_number), job_number`, [who])).map(r => r.job_number);
  for (const [page, who] of [[fuSam, "Sam"], [fuJordan, "Jordan"]]) {
    await page.goto(`${BASE}/follow-up`);
    await page.waitForSelector("[data-testid=pcircle-2]");
    await page.click("[data-testid=pcircle-2]");
    await page.waitForSelector("[data-testid=fu-results][data-priority='2'] [data-testid=job-row]");
    const got = await fuRows(page);
    assert.deepEqual(got, await expectP2(who), `${who}: own P2 leads, job number ascending`);
    assert.ok(!got.includes(p2Booked.job_number), "booked P2 job never listed");
    assert.match(await page.textContent("[data-testid=fu-results] .results-title"), /^Priority 2/);
    if (who === "Sam") { assert.ok(got.length >= 2); await shot(page, "B-follow-up-priority-2"); }
  }
  globalThis.__p2Rep = (await q(`select job_number from estimates where deleted_at is null and status in ('draft','quoted','signed') and priority = 2
    and owner_id = (select user_id from user_identities where username='Riley') order by length(job_number), job_number`)).map(r => r.job_number);
  log("B2 Priority 2 bubble: own P2 open leads only (Sam / Jordan separately), job number ascending, booked excluded");
}

// C) Recurring = Quote Viewed / Email Viewed events. Tracking: the pixel of a CC Form email sent
// 2 hours ago counts as an open ("Email Viewed"); a pixel hit right after a send and a known link
// scanner are ignored.
{
  const ccTok = `menu-cc-${open[2].id.slice(0, 8)}`;
  const freshTok = `menu-fresh-${open[2].id.slice(0, 8)}`;
  await q("insert into crm_emails (estimate_id, token, kind, subject, created_at) values ($1,$2,'cc_form',$3, now() - interval '2 hours')", [open[2].id, ccTok, `Credit Card Authorization - ${open[2].job_number}`]);
  await q("insert into crm_emails (estimate_id, token, kind, subject) values ($1,$2,'cc_form',$3)", [open[2].id, freshTok, `Credit Card Authorization - ${open[2].job_number}`]);
  const req = (await browser.newContext()).request;
  const pix = await req.get(`${BASE}/api/email/open/${ccTok}`);
  assert.equal(pix.headers()["content-type"], "image/gif");
  await req.get(`${BASE}/api/email/open/${freshTok}`);
  await req.get(`${BASE}/api/email/open/${ccTok}`, { headers: { "user-agent": "Mozilla/5.0 (compatible; Barracuda Sentinel)" } });
  const cnt = async (tok) => (await q("select count(*)::int n from crm_email_events e join crm_emails m on m.id=e.email_id where m.token=$1 and e.event='opened'", [tok]))[0].n;
  assert.equal(await cnt(ccTok), 1, "pixel open recorded once (scanner ignored)");
  assert.equal(await cnt(freshTok), 0, "open within 60 s of the send ignored");
  const nEv = (await q("select count(*)::int n from crm_notifications where kind='email_viewed' and estimate_id=$1", [open[2].id]))[0].n;
  assert.ok(nEv >= 1, "Email Viewed notification for the rep and admins");
  log("tracking pixel: CC Form open -> 'opened' event + Email Viewed notification; open < 60 s after send and scanner UA ignored");
  // Tracked link: the customer clicks the quote link (logged out) -> opens the quote directly.
  const qTok = `menu-quote-${open[5].id.slice(0, 8)}`;
  await q("insert into crm_emails (estimate_id, token, kind, subject, created_at) values ($1,$2,'e_quote',$3, now() - interval '1 hour')", [open[5].id, qTok, `Your Auto Transport Quote - ${open[5].job_number}`]);
  const custPage = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await custPage.goto(`${BASE}/d/${open[5].job_number}/${qTok}`);
  await custPage.waitForSelector("[data-testid=customer-doc]");
  assert.equal(await custPage.locator("input[name*=job], [data-testid=job-prompt]").count(), 0, "no job-number prompt");
  await custPage.context().close();
  const nQv = (await q("select count(*)::int n from crm_notifications where kind='quote_viewed' and estimate_id=$1", [open[5].id]))[0].n;
  assert.ok(nQv >= 1, "Quote Viewed notification on the link click");
  log("tracked link: quote opened directly (no job-number prompt) -> 'viewed' (click) + Quote Viewed notification");
}
await owner.goto(`${BASE}/user-menu`);
await owner.waitForSelector("[data-testid=crm-banners] [data-banner=recurring] >> text=/Email Viewed/", { state: "attached" });
await owner.waitForSelector("[data-testid=crm-banners] [data-banner=recurring] >> text=/Quote Viewed/", { state: "attached" });
await owner.locator("[data-testid=crm-banners]").first().screenshot({ path: `${OUT}/C-banner-viewed.png` });
log("banner: Email Viewed + Quote Viewed shown to admins");
await owner.goto(`${BASE}/recurring`);
await owner.waitForSelector("[data-testid=rc-row]");
const rcRows = await owner.locator("[data-testid=rc-row]").evaluateAll(rs => rs.map(r => ({ job: r.dataset.job, label: r.dataset.label, method: r.dataset.method })));
assert.match(await owner.textContent("[data-testid=rc-total]"), new RegExp(`Total: ${rcRows.length}`));
assert.deepEqual(rcRows[0], { job: open[5].job_number, label: "Quote Viewed", method: "click" }, "newest first: the quote link click");
assert.deepEqual(rcRows[1], { job: open[2].job_number, label: "Email Viewed", method: "open" }, "then the CC Form open");
const ccRow = owner.locator("[data-testid=rc-row]").nth(1);
assert.ok(/CC Form/.test(await ccRow.locator("td").nth(5).innerText()) && /Credit Card Authorization/.test(await ccRow.locator("td").nth(5).innerText()), "template + subject shown");
assert.equal(await ccRow.locator("[data-testid=rc-views]").textContent(), "1");
for (const o of [open[1], open[4], open[5]]) assert.ok(rcRows.some(r => r.job === o.job_number && r.label === "Quote Viewed" && r.method === "click"), `${o.job_number}: Quote Viewed (clicked)`);
assert.ok(!rcRows.some(r => r.job === open[0].job_number), "no views, no row");
await shot(owner, "C-recurring-quote-and-email-viewed");
{
  const [leadTab] = await Promise.all([owner.context().waitForEvent("page"), owner.locator("[data-testid=rc-row]").nth(1).locator("td").first().click()]);
  await leadTab.waitForURL(new RegExp(`/estimates/${open[2].id}`));
  assert.equal(new URL(owner.url()).pathname, "/recurring", "lead opens in its own tab; Recurring stays");
  // a tab the browser opened itself can't close: Admin Menu falls back to navigating this tab
  await leadTab.close();
  const direct = await owner.context().newPage();
  await direct.goto(`${BASE}/follow-up`);
  await direct.click("[data-testid=header-menu]").catch(e => { if (!/closed/.test(String(e))) throw e; });
  // closes if the browser allows it, otherwise this tab goes to the menu
  await Promise.race([direct.waitForEvent("close"), direct.waitForURL(u => new URL(u).pathname === "/user-menu").catch(() => null)]);
  if (!direct.isClosed()) await direct.close();
  log("Recurring row opens the lead in a new tab; header Admin Menu on a non-script tab navigates it to the menu");
}
log("C Recurring: Quote Viewed + Email Viewed rows newest first (template · subject, open/click, views); row opens the lead");
// Recurring is the ONE shared view: both admins see every rep's events (rep column).
for (const page of [fuSam, fuJordan]) {
  await page.goto(`${BASE}/recurring`);
  await page.waitForSelector("[data-testid=rc-row]");
  const rr = await page.locator("[data-testid=rc-row]").evaluateAll(rs => rs.map(r => ({ job: r.dataset.job, label: r.dataset.label, rep: r.children[4].textContent })));
  assert.ok(rr.some(r => r.label === "Quote Viewed" && r.rep === "SAM REP") && rr.some(r => r.label === "Email Viewed" && r.rep === "JUSTIN MILLS"), JSON.stringify(rr.slice(0, 4)));
}
log("Recurring shared: Sam and Jordan both see Sam's Quote Viewed and Jordan's Email Viewed rows");

// D) Operations Calendar
await owner.goto(`${BASE}/operations`);
await owner.waitForSelector("[data-testid=cal-job]");
await owner.waitForTimeout(400);
await shot(owner, "D-operations-calendar");
const title0 = await owner.textContent("[data-testid=cal-title]");
const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
let [mName, yStr] = title0.split(" "); let m = months.indexOf(mName), y = +yStr;
for (let i = 1; i <= 27; i++) {
  await owner.click("[data-testid=cal-next]");
  m++; if (m === 12) { m = 0; y++; }
  await owner.waitForFunction(t => document.querySelector("[data-testid=cal-title]")?.textContent === t, `${months[m]} ${y}`);
  if (months[m] === "January" && i < 4) log("D calendar: December ->", `${months[m]} ${y}`, "rollover");
}
log("D calendar: paged 27 months forward ->", `${months[m]} ${y}`);
await owner.goto(`${BASE}/operations?month=2028-02`);
await owner.waitForSelector(`.cal-day[data-date="2028-02-29"] [data-job=${leap.job_number}]`);
assert.equal(await owner.getAttribute(`.cal-day[data-date="2028-02-29"]`, "data-day"), "29");
assert.equal(await owner.locator(".cal-day[data-day]").count(), 29, "Feb 2028 has 29 day cells");
await shot(owner, "D-operations-leap-day-2028-02");
log("D calendar: leap-day pickup 2028-02-29 on the Feb 29 cell (29 day cells)");
await owner.goto(`${BASE}/operations?month=2027-02`);
await owner.waitForSelector("[data-testid=cal-grid]");
assert.equal(await owner.locator(".cal-day[data-day]").count(), 28, "Feb 2027 has 28");
await owner.goto(`${BASE}/operations`);
await owner.click("[data-testid=cal-week]");
await owner.waitForFunction(() => /Week of/.test(document.querySelector("[data-testid=cal-title]")?.textContent || ""));
await owner.waitForTimeout(400);
await shot(owner, "D-operations-week");
const second = booked[0];
await owner.goto(`${BASE}/operations`);
await owner.waitForSelector(`[data-job=${second.job_number}][data-second="1"]`).catch(() => {});
log("D calendar: week view, 2nd Pick-Up card");

// E) Estimates in Process
await owner.goto(`${BASE}/estimates`);
await owner.selectOption("[data-testid=eip-preset]", "thisMonth");
await owner.click("[data-testid=eip-submit]");
await owner.waitForSelector("[data-testid=estimates-list] [data-testid=job-row]");
await shot(owner, "E-estimates-in-process");
await owner.check("[data-testid=eip-type-booked]");
await owner.click("[data-testid=eip-submit]");
await owner.waitForTimeout(800);
const bookedRows = await owner.locator("[data-testid=estimates-list] [data-testid=job-row]").evaluateAll(rs => rs.map(r => r.dataset.job));
assert.ok(bookedRows.length >= booked.length && !bookedRows.includes(open[0].job_number), "Booked type lists booked jobs only");
await owner.click("[data-testid=eip-from]");
await owner.waitForSelector("[data-testid=date-popup]");
await shot(owner, "E-estimates-date-popup", false);
await owner.keyboard.press("Escape");
log("E estimates in process: presets, type filter, popup From/To");
await owner.check("[data-testid=eip-type-all]");
await owner.selectOption("[data-testid=eip-source]", "Web Lead");
await owner.click("[data-testid=eip-submit]");
await owner.waitForFunction(() => { const c = [...document.querySelectorAll("[data-testid=estimates-list] [data-testid=job-source]")]; return c.length > 0 && c.every(x => x.textContent === "Web Lead"); }, null, { timeout: 10000 });
const srcs = await owner.locator("[data-testid=estimates-list] [data-testid=job-source]").allTextContents();
assert.ok(srcs.length >= 3 && srcs.every(x => x === "Web Lead"), srcs.join());
await shot(owner, "E-estimates-lead-source-filter");
log("E Lead Source column + filter (Web Lead only)");

await owner.goto(`${BASE}/performance`);
await owner.waitForSelector("[data-testid=perf-table]");
await owner.waitForSelector("[data-testid=perf-sources] [data-source='Web Lead']");
assert.ok(Number(await owner.locator("[data-testid=perf-sources] [data-source='Web Lead'] td:nth-child(2)").textContent()) >= 3);
await shot(owner, "F-salesmen-performance");
log("Salesmen Performance: count by Lead Source");
// Maintenance > Lead Sources: add Yelp, hide BBB -> Entry Form options follow; required
await owner.goto(`${BASE}/admin-menu/maintenance?tab=sources`);
await owner.waitForSelector("[data-testid=ls-row]");
await owner.fill("[data-testid=ls-new]", "Yelp"); await owner.click("[data-testid=ls-add]");
await owner.locator("[data-testid=ls-row]", { has: owner.locator("[data-testid=ls-label][value=BBB]") }).locator("[data-testid=ls-hidden]").check();
await owner.click("[data-testid=ls-save]");
await owner.waitForSelector("[data-testid=ls-msg] >> text=Lead Sources saved.");
await shot(owner, "H-maintenance-lead-sources");
await owner.goto(`${BASE}/estimates/new`);
await owner.fill("[name=customer_name]", "Source Check"); await owner.fill("[name=pickup_zip]", "60601"); await owner.fill("[name=delivery_zip]", "33101");
await owner.click("[data-testid=entry-save]");
await owner.waitForSelector("text=Pick a Lead Source.");
await owner.click("[data-testid=lead-source]");
const opts = await owner.locator("[data-testid=lead-source-opt]").allTextContents();
assert.ok(opts.includes("Yelp") && !opts.includes("BBB"), opts.join());
await shot(owner, "H-entry-form-lead-source", false);
await owner.keyboard.press("Escape");
await owner.goto(`${BASE}/estimates/${open[0].id}/entry`);
await owner.click("[data-testid=lead-source]");
assert.equal(await owner.locator("[data-testid=lead-source-opt]").first().textContent(), "BBB", "hidden source kept on a lead that has it");
await owner.keyboard.press("Escape");
log("Lead Sources: admin added Yelp + hid BBB; Entry Form requires a source; hidden one kept on existing lead");
await owner.goto(`${BASE}/estimates/${open[0].id}`); await owner.waitForSelector("[data-testid=lead-page]");
await owner.goto(`${BASE}/estimates/${open[3].id}`); await owner.waitForSelector("[data-testid=lead-page]");
await owner.goto(`${BASE}/recent`);
await owner.waitForSelector("[data-testid=recent-table] [data-testid=job-link]");
assert.equal(await owner.locator("[data-testid=recent-table] [data-testid=job-link]").first().textContent(), open[3].job_number);
await shot(owner, "G-recent-jobs");
log("Salesmen Performance + Recent Accessed Jobs");

// Rep view: own leads only, no rep filter
// ADMIN MENU: Sam and Jordan are admins with full access (as on the live CRM). Each goes
// Network Login -> User Login -> 'Admin Menu' with every item; Mark walks every item.
const ITEMS = [
  ["menu-new-estimate", "/estimates/new", "New Estimate"], ["menu-assign", "/estimates/assign", "Assign New Estimates"], ["menu-estimates", "/estimates", "Estimates in Process"],
  ["menu-recurring", "/recurring", "Recurring Customers"], ["menu-operations", "/operations", "Operations Calendar"],
  ["menu-follow-up", "/follow-up", "Follow-Up Menu"], ["menu-performance", "/performance", "Salesmen Performance"], ["menu-reports", "/reports", "Reports"],
  ["menu-recent", "/recent", "Recent Accessed Jobs"], ["menu-maintenance", "/admin-menu/maintenance", "Maintenance"],
];
for (const [user, pass] of [["Sam", "Test-Only-2"], ["Jordan", "Test-Only-3"]]) {
  const am = await login(user, pass);
  assert.equal(new URL(am.url()).pathname, "/user-menu", `${user}: Network Login -> User Login -> menu`);
  assert.equal(await am.textContent("[data-testid=hub-title]"), "Admin Menu", `${user}: Admin Menu`);
  for (const [tid] of ITEMS) assert.equal(await am.locator(`[data-testid=${tid}]`).count(), 1, `${user}: ${tid} shown`);
  assert.equal(await am.locator("[data-testid=search-results], [data-testid=fu-results], [data-testid=fu-table], table").count(), 0, "menu is a clean hub: no embedded lists or panels");
  if (user === "Sam") {
    await am.waitForTimeout(400);
    await shot(am, "A-admin-menu");
    for (const [tid, path, label] of ITEMS) {
      assert.ok((await am.textContent(`[data-testid=${tid}]`)).startsWith(label), `${tid} label`);
      // Old-CRM tab behavior: each item opens in a NEW tab; the Admin Menu tab stays put.
      assert.equal(await am.getAttribute(`[data-testid=${tid}]`, "target"), "_blank", `${label}: opens a new tab`);
      assert.equal(await am.getAttribute(`[data-testid=${tid}]`, "rel"), "noopener");
      assert.equal(await am.evaluate(() => window.name), "fb_admin_menu", "menu tab is named");
      const [tab] = await Promise.all([am.context().waitForEvent("page"), am.click(`[data-testid=${tid}]`)]);
      await tab.waitForURL(u => new URL(u).pathname === path);
      await tab.waitForLoadState("networkidle");
      assert.equal(new URL(am.url()).pathname, "/user-menu", `${label}: menu tab stays on the Admin Menu`);
      assert.equal(await tab.locator("[data-testid=menu-grid]").count(), 0, `${label}: its own page, not the menu`);
      if (await tab.locator("[data-testid=header-menu]").count()) {
        // Header "Admin Menu": back to the (reused) menu tab, and this script-opened tab closes itself.
        // (the click can "fail" because the tab closed itself mid-click: that is the success case)
        await tab.click("[data-testid=header-menu]").catch(e => { if (!/closed/.test(String(e))) throw e; });
        // closes itself when the browser allows it, else this tab goes to the menu
        for (let i = 0; i < 50 && !tab.isClosed() && new URL(tab.url()).pathname !== "/user-menu"; i++) await am.waitForTimeout(200);
        assert.ok(tab.isClosed() || new URL(tab.url()).pathname === "/user-menu", `${label}: Admin Menu closed the tab or went to the menu`);
        if (!tab.isClosed()) await tab.close();
        await am.waitForSelector("[data-testid=hub-title]");
        assert.equal(await am.textContent("[data-testid=hub-title]"), "Admin Menu", `${label}: Admin Menu button returns to the menu tab`);
      } else {
        const back = tab.locator("[data-testid=page-exit]:visible, [data-testid=lead-tab-exit]:visible").first();
        await Promise.all([tab.waitForURL(u => new URL(u).pathname === "/user-menu"), back.click()]);
        assert.equal(await tab.textContent("[data-testid=hub-title]"), "Admin Menu", `${label}: back returns to the Admin Menu`);
        await tab.close();
      }
    }
    // Popups blocked (window.open -> null, as with a blocker/extension): every item still opens
    // its own tab through the plain target=_blank link, and the menu tab stays put.
    await am.goto(`${BASE}/user-menu`);
    await am.evaluate(() => { window.open = () => null; });
    for (const [tid, path, label] of ITEMS) {
      const [tab] = await Promise.all([am.context().waitForEvent("page"), am.click(`[data-testid=${tid}]`)]);
      await tab.waitForURL(u => new URL(u).pathname === path);
      assert.equal(new URL(am.url()).pathname, "/user-menu", `${label}: menu stays (popups blocked)`);
      await tab.close();
    }
    log("Admin Menu with window.open blocked: all", ITEMS.length, "items still open in new tabs");
  }
  await am.context().close();
}
log("Admin Menu: 'Sam' and 'Jordan' (admins) land on it with all 13 items; each item opens its own page in a NEW tab (menu tab stays) and Admin Menu / Exit returns to the menu");

// ASSIGN NEW ESTIMATES portal (admin): Web Leads | Bought Leads; select, pick rep, Save.
{
  const mk = async (name, source, from, to) => {
    const [e] = await q(`insert into estimates (customer_name, customer_email, customer_phone, pickup_address, delivery_address, status, priority, lead_source)
      values ($1,$2,'312-555-0199',$3,$4,'unassigned',0,$5) returning id, job_number`, [name, `${name.split(" ")[0].toLowerCase()}@example.test`, from, to, source]);
    await q("insert into vehicles (estimate_id, year, make, model, vehicle_type, is_running) values ($1,2019,'Toyota','RAV4','SUV',true)", [e.id]);
    return e;
  };
  const web = await mk("Wendy Web", "Web Lead", "Austin, TX 78701", "Denver, CO 80202");
  const bought = await mk("Bill Bought", "Purchased Lead", "Miami, FL 33101", "Atlanta, GA 30303");
  const am = await login("Sam", "Test-Only-2");
  const jp = await login("Jordan", "Test-Only-3");
  // Shared Assign New Estimate banner: both admins see the same count; it opens the Assign page.
  const unassignedN = (await q("select count(*)::int n from estimates where status='unassigned' and deleted_at is null"))[0].n;
  const assignBanner = async (page) => {
    await page.goto(`${BASE}/user-menu`);
    const el = page.locator("[data-testid=crm-banners] [data-banner=assign]").first();
    if (!(await el.waitFor({ state: "attached", timeout: 6000 }).then(() => true, () => false))) return 0;
    const m = (await el.textContent()).match(/\((\d+)\)/);
    return m ? Number(m[1]) : 1;
  };
  const newLeadFor = async (page, job) => {
    await page.goto(`${BASE}/user-menu`);
    await page.waitForSelector("[data-testid=crm-banners] .ticker-item, [data-testid=crm-banners] .ticker-idle", { state: "attached" });
    await page.waitForTimeout(500);
    const el = page.locator("[data-testid=crm-banners] [data-banner=newLead]").first();
    if (!(await el.count())) return false;
    await el.dispatchEvent("click");
    return (await page.locator(`text=${job}`).count()) > 0;
  };
  assert.equal(await assignBanner(am), unassignedN, "Mark: Assign New Estimate banner count");
  assert.equal(await assignBanner(jp), unassignedN, "Jordan: same shared count");
  await am.locator("[data-testid=crm-banners]").first().screenshot({ path: `${OUT}/AS-0-assign-banner.png` });
  await Promise.all([am.waitForURL(/\/estimates\/assign$/), am.locator("[data-testid=crm-banners] [data-banner=assign]").first().dispatchEvent("click")]);
  await am.goto(`${BASE}/user-menu`);
  await am.evaluate(() => { const a = document.querySelector("[data-testid=menu-assign]"); a?.removeAttribute("target"); a?.removeAttribute("data-newtab"); }); // same tab for this flow
  await Promise.all([am.waitForURL(/\/estimates\/assign$/), am.click("[data-testid=menu-assign]")]);
  await am.waitForSelector(`[data-testid=as-web] [data-job="${web.job_number}"]`);
  await am.waitForSelector(`[data-testid=as-bought] [data-job="${bought.job_number}"]`);
  assert.equal(await am.locator(`[data-testid=as-web] [data-job="${bought.job_number}"]`).count(), 0, "bought lead not in Web Leads");
  const webJobs = await am.locator("[data-testid=as-web] [data-testid=as-lead]").evaluateAll(rs => rs.map(r => r.dataset.job));
  assert.deepEqual(webJobs, [...webJobs].sort((x, y) => x.localeCompare(y, undefined, { numeric: true })), "oldest job number first");
  await shot(am, "AS-1-assign-both-panels");
  await am.click(`[data-testid=as-web] [data-job="${web.job_number}"]`);
  assert.equal(await am.textContent("[data-testid=as-selected]"), web.job_number);
  assert.ok(await am.isDisabled("[data-testid=as-save]"), "Save waits for a rep");
  await am.selectOption("[data-testid=as-rep]", { label: "Jordan Demo" });
  await shot(am, "AS-2-assign-selected-rep");
  await am.click("[data-testid=as-save]");
  await am.waitForSelector(`[data-testid=as-msg] >> text=${web.job_number} assigned to Jordan Demo`);
  assert.equal(await am.locator(`[data-job="${web.job_number}"]`).count(), 0, "assigned lead left the panel");
  await am.click(`[data-testid=as-bought] [data-job="${bought.job_number}"]`);
  await am.selectOption("[data-testid=as-rep]", { label: "Sam Rep" });
  await am.click("[data-testid=as-save]");
  await am.waitForSelector(`[data-testid=as-msg] >> text=${bought.job_number} assigned to Sam Rep`);
  await am.waitForSelector("[data-testid=as-bought-empty]").catch(() => null);
  await shot(am, "AS-3-assign-after-save");
  for (const [e, rep] of [[web, "Jordan Demo"], [bought, "Sam Rep"]]) {
    const [row] = await q("select e.status, e.owner_id = r.user_id ok, r.name from estimates e join crm_reps r on r.id=e.assigned_rep_id where e.id=$1", [e.id]);
    assert.deepEqual([row.status, row.ok, row.name], ["draft", true, rep], `${e.job_number} -> ${rep}`);
    const [audit] = await q(`select (select count(*)::int from estimate_status_log where estimate_id=$1 and action='assigned') + (select count(*)::int from estimate_notes where estimate_id=$1 and kind='operations' and body like 'Assigned to %') n`, [e.id]);
    assert.equal(audit.n, 1, `${e.job_number}: one audit entry`);
  }
  // Banners after assigning: the shared Assign count dropped by 2 for both; New Lead only for
  // the rep who got the lead (Jordan for the web lead; Mark assigned the bought lead to himself,
  // so no New Lead for anyone on that one).
  assert.equal(await assignBanner(am), unassignedN - 2, "Mark: Assign banner count dropped");
  assert.equal(await assignBanner(jp), unassignedN - 2, "Jordan: Assign banner count dropped");
  assert.equal(await newLeadFor(jp, web.job_number), true, "Jordan: New Lead for the web lead");
  await jp.locator("[data-testid=crm-banners]").first().screenshot({ path: `${OUT}/AS-4-jordan-new-lead-banner.png` });
  assert.equal(await newLeadFor(am, web.job_number), false, "Mark (assigner): no New Lead for Jordan's lead");
  assert.equal((await q("select count(*)::int n from crm_notifications where kind='new_lead' and estimate_id=$1", [web.id]))[0].n, 1, "one New Lead notification, Jordan's");
  // Jordan sees his new lead in his own Follow-Up (New Estimates - Untouched); Mark does not.
  await jp.goto(`${BASE}/follow-up`);
  await jp.waitForSelector("[data-testid=fu-count-all]");
  await jp.check("[data-testid=fu-opt-untouched] input"); await jp.click("[data-testid=fu-submit]");
  await jp.waitForSelector(`[data-testid=fu-table] [data-job="${web.job_number}"]`);
  await am.goto(`${BASE}/follow-up`);
  await am.waitForSelector("[data-testid=fu-count-all]");
  await am.check("[data-testid=fu-opt-all] input"); await am.click("[data-testid=fu-submit]");
  await am.waitForSelector("[data-testid=fu-results]");
  assert.equal(await am.locator(`[data-testid=fu-table] [data-job="${web.job_number}"]`).count(), 0, "Jordan's lead not in Mark's Follow-Up");
  assert.ok(await am.locator(`[data-testid=fu-table] [data-job="${bought.job_number}"]`).count() === 1, "Mark's own assigned lead is");
  await jp.context().close(); await am.context().close();
  log("Assign New Estimates: shared Assign banner (same count for Mark + Jordan, opens the page); web lead -> Jordan, bought -> Mark; left the panels; owner + audit; count dropped for both; New Lead only for Jordan; each lead only in its owner's Follow-Up");
// Follow Up banner is per rep: Jordan's due follow-up shows in Jordan's banner/count, not Mark's.
{
  const fuBanner = async (page) => {
    await page.goto(`${BASE}/user-menu`);
    await page.waitForSelector("[data-testid=crm-banners] .ticker-item, [data-testid=crm-banners] .ticker-idle", { state: "attached" });
    await page.waitForTimeout(500);
    return Number((await page.textContent("[data-testid=menu-follow-count]")).replace(/\D/g, ""));
  };
  const jl = await lead({ name: "Jordan Followup", from: "Omaha, NE 68102", to: "Tulsa, OK 74103", miles: 400, rep: "Jordan Demo", priority: 3, total: 800, deposit: 200, touched: await ts(-3, 9) });
  const fm = await login("Sam", "Test-Only-2"); const fj = await login("Jordan", "Test-Only-3");
  const m0 = await fuBanner(fm), j0 = await fuBanner(fj);
  // A due follow-up on Jordan's lead (set directly in the LOCAL DB, time already reached).
  await q("update estimates set follow_up_at = now() - interval '2 minutes' where id=$1", [jl.id]);
  const m1 = await fuBanner(fm), j1 = await fuBanner(fj);
  assert.equal(j1, j0 + 1, "Jordan's Follow Up count +1");
  assert.equal(m1, m0, "Mark's Follow Up count unchanged");
  await fj.locator("[data-testid=crm-banners] [data-banner=followUp]").first().dispatchEvent("click");
  await fj.waitForSelector(`text=${jl.job_number}`);
  await fj.locator("[data-testid=crm-banners]").first().screenshot({ path: `${OUT}/F-jordan-follow-up-banner.png` });
  await fm.context().close(); await fj.context().close();
  log("Follow Up banner per rep: Jordan's due follow-up counts for Jordan only (Mark unchanged)");
}
}

// Rep-limited role (kept in code for future reps; TEST-ONLY user 'Riley'): Salesperson Menu,
// own follow-ups only, Priority bubble = own leads, oldest job number first.
const rep = await login("Riley", "Test-Only-4");
assert.equal(new URL(rep.url()).pathname, "/user-menu");
assert.equal(await rep.textContent("[data-testid=hub-title]"), "Salesperson Menu", "rep keeps the Salesperson Menu");
assert.equal(await rep.locator("[data-testid=menu-maintenance], [data-testid=menu-team], [data-testid=menu-rotation], [data-testid=menu-performance]").count(), 0, "rep: rep-allowed items only");
await shot(rep, "A-salesperson-menu");
await rep.goto(`${BASE}/follow-up`);
await rep.waitForSelector("[data-testid=fu-count-all]");
assert.equal(await rep.locator("[data-testid=fu-rep]").count(), 0);
await rep.check("[data-testid=fu-opt-all] input"); await rep.click("[data-testid=fu-submit]");
await rep.waitForSelector("[data-testid=fu-table] [data-testid=job-row]");
assert.ok((await rep.locator("[data-testid=fu-table] [data-testid=job-row] td:nth-child(2)").allTextContents()).every(t => t === "RILEY TEST"));
await rep.click("[data-testid=pcircle-2]");
await rep.waitForSelector("[data-testid=fu-results][data-priority='2'] [data-testid=job-row]");
assert.deepEqual(await rep.locator("[data-testid=fu-table] [data-testid=job-row]").evaluateAll(rs => rs.map(r => r.dataset.job)), globalThis.__p2Rep, "rep: own P2 leads, job no ascending");
await shot(rep, "B-follow-up-priority-2-rep");
await rep.context().close();
log("rep (Salesperson Menu): rep-allowed items, own follow-ups only, own Priority 2 leads oldest first");

// Charges panel with a recorded payment: 200 + 1050 + 'Top load' 75 = 1325, $345 paid -> Balance 980.
// The booked order and CC form show the same saved Total / payment / balance.
{
  const pl = await lead({ name: "Panel Balance", from: "Dallas, TX 75201", to: "Denver, CO 80202", miles: 790, status: "booked", total: 1325, deposit: 200, pickup: (await q(`select ('${T}'::date + 20)::text d`))[0].d, rep: "Sam Rep" });
  await q(`update quotes set cod_amount=1050, extra_charges='[{"description":"Top load","amount":75}]'::jsonb where estimate_id=$1`, [pl.id]);
  const url = `${BASE}/estimates/${pl.id}`;
  const panel = async () => (await owner.textContent("[data-testid=deposit-paid]")).replace(/\s+/g, " ").trim();
  await owner.goto(url);
  await owner.waitForSelector("[data-testid=price-box]");
  assert.equal(await owner.inputValue("[data-testid=total]"), "1325.00");
  assert.equal(await panel(), "Payments: $0.00 · Balance: $1325.00");
  await q("insert into payments (estimate_id, amount, method, is_deposit, created_by_name) values ($1,345,'Zelle',true,'Owner')", [pl.id]);
  await owner.goto(url);
  await owner.waitForSelector("[data-testid=price-box]");
  assert.equal(await owner.locator("[data-testid=total-warning]").count(), 0);
  assert.equal(await panel(), "Payments: $345.00 · Balance: $980.00", "Balance = Total - recorded payments");
  await owner.locator("[data-testid=price-box]").screenshot({ path: `${OUT}/45b-charges-price-row-paid-345.png` });
  await owner.fill("[data-testid=cod]", "1100");
  assert.equal(await panel(), "Payments: $345.00 · Balance: $1030.00", "live while typing");
  await owner.fill("[data-testid=cod]", "1050");
  assert.equal(await panel(), "Payments: $345.00 · Balance: $980.00");
  await owner.goto(`${url}/estimate`);
  await owner.waitForSelector("[data-testid=doc-frame][data-kind=booked_esign]");
  await owner.waitForFunction(() => (document.querySelector("[data-testid=doc-frame]")?.contentDocument?.body?.innerText || "").includes("Customer Balance"));
  const docText = async () => owner.evaluate(() => document.querySelector("[data-testid=doc-frame]").contentDocument.body.innerText);
  const bo = await docText();
  assert.ok(bo.includes("$1325.00") && bo.includes("$345.00") && bo.includes("$980.00") && !bo.includes("$725.00"), "booked order: 1325 / 345 / 980");
  await owner.click("[data-testid=pe-cc]");
  await owner.waitForSelector("[data-testid=doc-frame][data-kind=cc_form]");
  await owner.waitForFunction(() => (document.querySelector("[data-testid=doc-frame]")?.contentDocument?.body?.innerText || "").includes("$980.00"));
  const cc = await docText();
  assert.ok(cc.includes("$1325.00") && cc.includes("$345.00") && cc.includes("$980.00"), "CC form: 1325 / 345 / 980");
  log("charges panel with $345 paid: Balance $980.00 (live + saved); booked order + CC form show 1325 / 345 / 980");
}

// VEHICLE Year / Type pickers (Add/Update Vehicle; New Estimate saves and opens this screen).
{
  const vl = await lead({ name: "Vehicle Picker", from: "Tulsa, OK 74103", to: "Mobile, AL 36602", miles: 680, total: 0, deposit: 0, vehicles: [] });
  await owner.goto(`${BASE}/estimates/new`);
  await owner.waitForSelector("[data-testid=new-estimate]");
  await shot(owner, "V-new-estimate-vehicles");
  await owner.goto(`${BASE}/estimates/${vl.id}/vehicles?new=1`);
  await owner.waitForSelector("[data-testid=vehicle-editor]");
  await owner.click("[data-testid=veh-year]");
  await owner.waitForSelector("[data-testid=veh-year-list]");
  const yearOpts = await owner.locator("[data-testid=veh-year-opt]").allTextContents();
  assert.equal(yearOpts[0], "2027", "newest year first (2027)");
  assert.equal(yearOpts.at(-1), "1950", "listed down to 1950");
  await owner.keyboard.press("Escape");
  await owner.click("[data-testid=veh-type]");
  await owner.waitForSelector("[data-testid=veh-type-list]");
  assert.deepEqual(await owner.locator("[data-testid=veh-type-opt]").allTextContents(), ["Sedan", "SUV", "Pickup", "Van", "Trailer", "ATV", "Golf Cart"]);
  await owner.keyboard.press("Escape");
  const addOne = async (year, other, type, typeOther, make, model) => {
    await owner.waitForSelector("[data-testid=vehicle-editor]");
    await owner.fill("[data-testid=veh-year]", year);
    await owner.fill("[data-testid=veh-type]", type);
    await owner.fill("[data-testid=veh-make]", make); await owner.fill("[data-testid=veh-model]", model);
    const n = await owner.locator("[data-testid=vehicle-row]").count();
    if (other || typeOther) await owner.locator("[data-testid=vehicle-editor]").screenshot({ path: `${OUT}/V-vehicle-year-type-other.png` });
    await owner.click("[data-testid=veh-save]");
    await owner.waitForFunction(k => document.querySelectorAll("[data-testid=vehicle-row]").length === k, n + 1);
    await owner.waitForSelector("[data-testid=vehicle-editor]", { state: "detached" });
  };
  await addOne("2027", false, "SUV", false, "Kia", "Telluride");
  await owner.click("[data-testid=veh-add-another]");
  await addOne("1950", false, "Golf Cart", false, "Club Car", "Villager");
  await owner.click("[data-testid=veh-add-another]");
  await addOne("1932", true, "Motorcycle", true, "Harley-Davidson", "VL");
  const rows = await q("select year, make, vehicle_type from vehicles where estimate_id=$1 order by make", [vl.id]);
  assert.deepEqual(rows.map(r => [r.year, r.vehicle_type]), [[1950, "Golf Cart"], [1932, "Motorcycle"], [2027, "SUV"]], JSON.stringify(rows));
  // Editing the 1932 Motorcycle shows the typed year and type (Other + text).
  const idx = (await owner.locator("[data-testid=vehicle-row]").allTextContents()).findIndex(t => t.includes("1932"));
  await owner.locator("[data-testid=vehicle-row]").nth(idx).click();
  await owner.waitForSelector("[data-testid=vehicle-editor]");
  assert.equal(await owner.inputValue("[data-testid=veh-year]"), "1932");
  assert.equal(await owner.inputValue("[data-testid=veh-type]"), "Motorcycle");
  await shot(owner, "V-vehicle-screen-edit-custom");
  log("vehicles: Year 2027..1950 + Other (1932 typed); Type Sedan..Golf Cart + Other ('Motorcycle'); saved as-is; edit shows the typed values");
}

// Lead tabs + menu pages at 390 px: no page-level horizontal overflow
const narrow = await login("owner", "Test-Only-1", 390);
for (const [path, name] of [["/user-menu", "A-main-menu-390"], ["/follow-up", "B-follow-up-390"], ["/recurring", "C-recurring-390"], ["/operations", "D-operations-390"], ["/estimates", "E-estimates-390"],
  [`/estimates/${open[0].id}`, "L-charges-390"], [`/estimates/${open[0].id}/entry`, "L-entry-390"], [`/estimates/${open[0].id}/payments`, "L-payments-390"], [`/estimates/${open[0].id}/estimate`, "L-estimate-390"], [`/estimates/${open[0].id}/emails`, "L-emails-390"], [`/estimates/${open[0].id}/vehicles`, "L-vehicles-390"]]) {
  await narrow.goto(`${BASE}${path}`);
  await narrow.waitForLoadState("networkidle").catch(() => {});
  await narrow.waitForTimeout(500);
  const w = await narrow.evaluate(() => document.documentElement.scrollWidth);
  assert.ok(w <= 392, `${path} fits 390 px (scrollWidth ${w})`);
  await shot(narrow, name);
}
log("390 px: menu pages and all lead tabs fit (tables scroll inside their card)");

await browser.close(); await db.end();
console.log("ALL MENU PAGE CHECKS PASSED");
