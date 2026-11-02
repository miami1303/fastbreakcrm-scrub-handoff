"use client";

// Signs all staff out at midnight America/Chicago. Daytime idle logout is disabled.
// Sessions stay open while the CRM is open during the day.
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { signOutIdle } from "@/app/actions/activity";

const CRM_PREFIXES = ["/user-menu", "/inbox", "/admin-menu", "/estimates", "/leads", "/operations", "/follow-up", "/recurring", "/performance", "/recent", "/search", "/reports"];

function isPastMidnightChicago(now = new Date()): boolean {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", hour: "numeric", hourCycle: "h23" }).formatToParts(now);
  const hour = Number(parts.find(p => p.type === "hour")?.value || 0);
  return hour === 0; // only the midnight hour triggers once per night
}

export default function IdleSignOut() {
  const path = usePathname() || "";
  const active = CRM_PREFIXES.some(p => path === p || path.startsWith(`${p}/`));
  useEffect(() => {
    if (!active) return;
    let done = false;
    const check = () => {
      if (done) return;
      if (isPastMidnightChicago()) {
        done = true;
        signOutIdle().catch(() => { window.location.href = "/?error=midnight"; });
      }
    };
    // Check every minute; only acts at midnight Chicago.
    const t = setInterval(check, 60_000);
    check();
    return () => clearInterval(t);
  }, [active]);
  return null;
}
