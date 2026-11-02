// TEST ONLY: visual polish walkthrough against the LOCAL stack (run after core-flow + menu-pages).
// Every page at desktop (1280) and phone (390) width: no console errors, no horizontal overflow,
// no placeholder / debug text, no empty buttons or dead "#" links. Every email template
// (html logged at send) rendered at 600 px and 390 px with the same checks.
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
if (!/@(127\.0\.0\.1|localhost)[:/]/.test(DB_URL)) throw new Error("LOCAL test DB only");
const db = new pg.Client({ connectionString: DB_URL });
await db.connect();
const q1 = async (sql, p = []) => (await db.query(sql, p)).rows[0];
const log = (...a) => console.log("✓", ...a);
const browser = await chromium.launch({ executablePath: process.env.CHROME || "/usr/bin/google-chrome", args: ["--no-sandbox"] });
const problems = [];

const BAD_TEXT = /\b(TODO|FIXME|lorem ipsum|coming soon|placeholder|undefined|NaN|\[object Object\])\b|\bnull\b(?![-\w])/i;
async function audit(page, name) {
  const r = await page.evaluate(() => {
    const W = document.documentElement.clientWidth;
    const over = document.documentElement.scrollWidth - W;
    // elements sticking out of the viewport (ignore things inside a horizontal scroller)
    const wide = [];
    for (const el of document.querySelectorAll("body *")) {
      const b = el.getBoundingClientRect();
      if (b.width === 0 || b.right <= W + 1) continue;
      let p = el.parentElement, scroller = false;
      while (p) { const s = getComputedStyle(p); if (/(auto|scroll|hidden)/.test(s.overflowX) && p.scrollWidth > p.clientWidth - 1) { scroller = true; break; } p = p.parentElement; }
      if (!scroller) wide.push(`${el.tagName.toLowerCase()}${el.dataset.testid ? `[${el.dataset.testid}]` : el.className && typeof el.className === "string" ? "." + el.className.split(" ")[0] : ""}`);
      if (wide.length > 4) break;
    }
    const emptyButtons = [...document.querySelectorAll("button, a")].filter(b => {
      const vis = b.getBoundingClientRect().width > 0;
      return vis && !b.textContent.trim() && !b.getAttribute("aria-label") && !b.getAttribute("title") && !b.querySelector("img[alt], svg[aria-label]");
    }).map(b => b.outerHTML.slice(0, 80));
    const deadLinks = [...document.querySelectorAll("a")].filter(a => { const h = a.getAttribute("href"); return a.getBoundingClientRect().width > 0 && (h === null || h === "" || (h === "#" && !a.dataset.esignLink)); }).map(a => a.outerHTML.slice(0, 80));
    return { over, wide, emptyButtons, deadLinks, text: document.body.innerText };
  });
  const bad = BAD_TEXT.exec(r.text);
  const out = [];
  if (r.over > 1) out.push(`horizontal overflow ${r.over}px (${r.wide.join(", ")})`);
  if (bad) out.push(`placeholder/debug text "${bad[0]}" near "${r.text.slice(Math.max(0, bad.index - 30), bad.index + 30).replace(/\s+/g, " ")}"`);
  if (r.emptyButtons.length) out.push(`empty buttons: ${r.emptyButtons.join(" | ")}`);
  if (r.deadLinks.length) out.push(`dead links: ${r.deadLinks.join(" | ")}`);
  for (const o of out) problems.push(`${name}: ${o}`);
  return out;
}
function watch(page, name) {
  page.on("console", m => { if (m.type() === "error" && !/favicon/.test(m.text())) problems.push(`${name()}: console error: ${m.text().slice(0, 200)}`); });
  page.on("response", r => { if (r.status() === 404) problems.push(`${name()}: 404 ${r.url()}`); });
  page.on("pageerror", e => problems.push(`${name()}: page error: ${e.message.slice(0, 200)}`));
}

async function staff(width) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 } });
  const page = await ctx.newPage();
  let cur = "login"; watch(page, () => `${cur}@${width}`);
  page.on("dialog", d => d.dismiss());
  await page.goto(`${BASE}/`); cur = "network-login"; await audit(page, `network-login@${width}`);
  if (width === 1280) await page.screenshot({ path: `${OUT}/P-network-login.png` });
  await networkLogin(page);
  cur = "user-login"; await audit(page, `user-login@${width}`);
  if (width === 1280) await page.screenshot({ path: `${OUT}/P-user-login.png` });
  await page.fill("#username", "Sam"); await page.fill("#password", "Test-Only-2");
  await Promise.all([page.waitForURL(/menu/), page.click("button[type=submit]")]);
  return { page, set: n => (cur = n) };
}

// The lead with the most kinds of customer emails sent (the core-flow job).
const lead = await q1("select e.id, e.job_number from estimates e join crm_emails m on m.estimate_id=e.id and m.html_snapshot is not null and m.kind <> 'free_text' where e.deleted_at is null group by e.id order by count(distinct m.kind) desc, e.created_at limit 1");
const pages = [
  ["admin-menu", "/user-menu"], ["follow-up", "/follow-up"], ["new-estimate", "/estimates/new"], ["assign", "/estimates/assign"],
  ["estimates-in-process", "/estimates"], ["search", "/search?q=riv"], ["recurring", "/recurring"], ["operations", "/operations"],
  ["performance", "/performance"], ["reports", "/reports"], ["recent", "/recent"], ["maintenance", "/admin-menu/maintenance"],
  ["rotation", "/admin-menu/settings"], ["team", "/admin-menu/team"], ["company", "/admin-menu/company"],
  ["lead", `/estimates/${lead.id}`], ["lead-entry", `/estimates/${lead.id}/entry`], ["lead-charges", `/estimates/${lead.id}/charges`],
  ["lead-vehicles", `/estimates/${lead.id}/vehicles`], ["lead-emails", `/estimates/${lead.id}/emails`], ["lead-payments", `/estimates/${lead.id}/payments`],
  ["lead-estimate", `/estimates/${lead.id}/estimate`],
];
for (const width of [1280, 390]) {
  const { page, set } = await staff(width);
  for (const [name, path] of pages) {
    set(name);
    const res = await page.goto(`${BASE}${path}`);
    assert.ok(res && res.status() < 400, `${name} ${path} -> ${res && res.status()}`);
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(400);
    // every page except the hub has its way back to the menu
    if (name !== "admin-menu") {
      const back = await page.locator("[data-testid=page-exit], [data-testid=page-back], [data-testid=lead-tab-exit], [data-testid=eip-exit], a[href='/user-menu']").count();
      if (!back) problems.push(`${name}@${width}: no Exit/Back to menu`);
    }
    await audit(page, `${name}@${width}`);
    await page.screenshot({ path: `${OUT}/P-${name}${width === 390 ? "-390" : ""}.png`, fullPage: width === 1280 });
  }
  await page.context().close();
  log(`staff pages audited at ${width}px:`, pages.length);
}

// Customer pages (logged out) + every email template that was sent in core-flow.
const kinds = (await db.query("select distinct on (kind) kind, token, html_snapshot from crm_emails where estimate_id=$1 and html_snapshot is not null order by kind, created_at desc", [lead.id])).rows;
const anyFree = await q1("select kind, token, html_snapshot from crm_emails where kind='free_text' and html_snapshot is not null order by created_at desc limit 1");
if (anyFree && !kinds.some(k => k.kind === "free_text")) kinds.push(anyFree);
for (const width of [390, 1280]) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 } });
  const page = await ctx.newPage();
  let cur = ""; watch(page, () => cur);
  for (const k of kinds.filter(k => k.kind !== "free_text")) {
    cur = `customer-${k.kind}@${width}`;
    await page.goto(`${BASE}/d/${lead.job_number}/${k.token}`);
    await page.waitForSelector("[data-testid=customer-doc]");
    await audit(page, cur);
    await page.screenshot({ path: `${OUT}/P-customer-${k.kind}${width === 390 ? "-390" : ""}.png`, fullPage: true });
  }
  await ctx.close();
}
log("customer pages audited at 390px and 1280px:", kinds.filter(k => k.kind !== "free_text").map(k => k.kind).join(", "));
for (const width of [600, 390]) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, javaScriptEnabled: false });
  const page = await ctx.newPage();
  for (const k of kinds) {
    await page.setContent(k.html_snapshot, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(300);
    const html = k.html_snapshot;
    if (!html.includes("fastbreak-logo.png")) problems.push(`email-${k.kind}: no logo`);
    if (!/Fast Break/.test(html)) problems.push(`email-${k.kind}: no brand name`);
    await audit(page, `email-${k.kind}@${width}`);
    await page.screenshot({ path: `${OUT}/P-email-${k.kind}${width === 390 ? "-390" : ""}.png`, fullPage: true });
  }
  await ctx.close();
}
log("email templates audited at 600px and 390px:", kinds.map(k => k.kind).join(", "));

await browser.close(); await db.end();
if (problems.length) { console.log("POLISH PROBLEMS:\n" + [...new Set(problems)].join("\n")); process.exit(1); }
console.log("ALL POLISH CHECKS PASSED");
