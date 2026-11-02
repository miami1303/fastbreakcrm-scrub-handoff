"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

export const MENU_PATH = "/user-menu";
export const MENU_WINDOW = "fb_admin_menu";

/** Set right before the header Admin Menu leaves/closes this tab on purpose, so a lead page's
 *  "unsaved changes" guard (beforeunload) does not pop the browser's "Leave site?" box
 *  (Owner 2026-10-31: Admin Menu should just take him back, like it used to). */
export const ALLOW_LEAVE_FLAG = "__crmAllowLeave";
export function allowLeave() { (window as unknown as Record<string, boolean>)[ALLOW_LEAVE_FLAG] = true; }
export function leaveAllowed() { return (window as unknown as Record<string, boolean>)[ALLOW_LEAVE_FLAG] === true; }

/**
 * Old-CRM tab behavior (Owner): the Admin Menu tab stays open (named "fb_admin_menu"); anything
 * marked data-newtab (menu items, leads in lists, the menu search) opens in its own tab via
 * window.open, so that tab can later close itself from the header's Admin Menu button.
 * Ctrl/Cmd/Shift/middle clicks keep the browser's own behavior.
 */
export default function TabLinks() {
  const path = usePathname();
  useEffect(() => {
    if (path === MENU_PATH) window.name = MENU_WINDOW;
  }, [path]);
  useEffect(() => {
    // Anchors open natively (target="_blank" in the markup): never popup-blocked. Only make sure
    // the target is set. Non-anchors (e.g. table rows) use window.open, falling back to
    // navigating this tab when a blocker returns null. Forms submit natively (target="_blank").
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const el = (e.target as HTMLElement | null)?.closest<HTMLElement>("[data-newtab]");
      if (!el || el.tagName === "FORM") return;
      if (el instanceof HTMLAnchorElement) { if (!el.target) el.target = "_blank"; return; }
      const url = el.getAttribute("data-newtab") || "";
      if (!url.startsWith("/")) return;
      e.preventDefault();
      e.stopPropagation();
      const w = window.open(url, "_blank");
      if (!w) window.location.href = url;
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);
  return null;
}

/** Header "Admin Menu": focus/reuse the menu tab, then close this tab (works for tabs opened by
 *  window.open); if the browser won't close it, go to the menu in this tab instead. */
export function AdminMenuButton() {
  return (
    <a href={MENU_PATH} className="crm-header-menu" data-testid="header-menu"
      onClick={e => {
        if (e.metaKey || e.ctrlKey || e.shiftKey) return;
        e.preventDefault();
        allowLeave();
        const w = window.open(MENU_PATH, MENU_WINDOW);
        if (!w) { window.location.href = MENU_PATH; return; }
        window.close();
        setTimeout(() => { if (!window.closed) window.location.href = MENU_PATH; }, 300);
      }}>Admin Menu</a>
  );
}
