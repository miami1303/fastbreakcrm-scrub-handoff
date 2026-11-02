import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = p => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("Maintenance: Users, User Invites, Lead Rotation and Priorities are each their own tab", () => {
  const s = read("app/admin-menu/maintenance/page.tsx");
  for (const [id, label] of [["users", "Users"], ["invites", "User Invites"], ["rotation", "Lead Rotation"], ["priorities", "Priorities"]])
    assert.match(s, new RegExp(`id: "${id}", label: "${label}"`));
  assert.match(s, /<SettingsPanel embedded \/>/);
});

test("Advanced Search removed from the main menu; Inbox is labelled Email Inbox", () => {
  const menu = read("app/user-menu/page.tsx");
  assert.doesNotMatch(menu, /Advanced Search|menu-advanced/);
  assert.match(menu, /Email Inbox \(info@\)/);
  assert.match(read("app/components/InboxBell.tsx"), /header-inbox">Email Inbox/);
  assert.match(read("app/inbox/page.tsx"), /title="Email Inbox — support@/);
});

test("Tabs are spread evenly across the bar", () => {
  assert.match(read("app/globals.css"), /\.tab \{ flex: 1 1 0;/);
});

test("Users and Lead Rotation are Maintenance tabs only, not Admin Menu tiles", () => {
  const menu = read("app/user-menu/page.tsx");
  assert.doesNotMatch(menu, /menu-team|menu-rotation|tab=users|tab=rotation|>Users<|>Lead Rotation|Users & Invites|Rotation & Priorities/);
  assert.match(menu, /menu-maintenance/);
  const m = read("app/admin-menu/maintenance/page.tsx");
  assert.match(m, /params.get\("tab"\)/);
});
