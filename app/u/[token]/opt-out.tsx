"use client";

import { useEffect, useRef, useState } from "react";
import { unsubscribe } from "@/app/actions/optout";
import BrandLogo from "@/app/components/BrandLogo";

// Runs on page load in the customer's browser (link scanners that only fetch the page
// don't run scripts, so they can't opt a customer out by accident).
export default function OptOut({ token }: { token: string }) {
  const [state, setState] = useState<{ done?: number; error?: string } | null>(null);
  const ran = useRef(false);
  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    unsubscribe(token).then(r => setState(r.ok ? { done: r.blockId } : { error: r.error }));
  }, [token]);
  return (
    <div data-testid="optout">
      <div style={{ display: "flex", justifyContent: "center", marginBottom: 16 }}><BrandLogo height={56} /></div>
      {!state && <p>One moment…</p>}
      {state?.done && <>
        <h1 style={{ fontSize: 20, margin: "0 0 8px" }}>You&apos;re unsubscribed</h1>
        <p style={{ fontSize: 14, color: "#424649" }} data-testid="optout-done">We won&apos;t email this address again. Reference: Block ID {state.done}.</p>
      </>}
      {state?.error && <p style={{ color: "var(--brand-red)" }}>{state.error}</p>}
    </div>
  );
}
