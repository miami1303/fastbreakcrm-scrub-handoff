"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { signDocument } from "@/app/actions/email";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * One compact bar at the very top (above the logo), left to right: agree checkbox | Name | Email | Sign.
 * Sign stays disabled until the box is checked, the email is valid and the name is filled.
 * The red link at the bottom of the document ("#esign") scrolls back up here.
 */
export default function SignRow({ token }: { token: string; defaultEmail?: string }) {
  const router = useRouter();
  const [agreed, setAgreed] = useState(false);
  const [email, setEmail] = useState(""); // the customer types it; Sign stays disabled until it is filled
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [focus, setFocus] = useState(false);
  const [signedAt, setSignedAt] = useState<string | null>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const ready = agreed && EMAIL_RE.test(email.trim()) && name.trim().length >= 2;

  useEffect(() => {
    function onClick(e: MouseEvent) {
      const a = (e.target as HTMLElement).closest("a[data-esign-link]");
      if (!a) return;
      e.preventDefault();
      window.scrollTo({ top: 0, behavior: "smooth" });
      setFocus(false);
      requestAnimationFrame(() => setFocus(true));
      rowRef.current?.querySelector<HTMLInputElement>("input[type=checkbox]")?.focus({ preventScroll: true });
    }
    document.addEventListener("click", onClick);
    if (window.location.hash === "#esign") setFocus(true);
    return () => document.removeEventListener("click", onClick);
  }, []);

  async function sign() {
    if (!ready) return;
    setBusy(true);
    setError("");
    const r = await signDocument(token, { agreed, email: email.trim(), name: name.trim() });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    // Same page, no redirect or landing page: confirm in place, then swap in the signed copy.
    setSignedAt(r.signedAt);
    router.refresh();
  }

  if (signedAt) return <div className="esign-done" data-testid="esign-done">Signed electronically {new Date(signedAt).toLocaleString()}. Thank you!</div>;
  return (
    <div id="esign" ref={rowRef} className={`esign-row${focus ? " focus" : ""}`} data-testid="esign-row">
      <label className="agree">
        <input type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)} data-testid="esign-agree" />
        I have read and agree to the{" "}
        <button type="button" className="terms-link" onClick={() => document.querySelector("[data-terms]")?.scrollIntoView({ behavior: "smooth", block: "center" })}>terms</button>
      </label>
      <input type="text" placeholder="Name" value={name} onChange={e => setName(e.target.value)} aria-label="Name" autoComplete="name" data-testid="esign-name" />
      <input type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} aria-label="Email" autoComplete="email" data-testid="esign-email" />
      <button type="button" disabled={!ready || busy} onClick={sign} data-testid="esign-submit">{busy ? "Signing…" : "Sign"}</button>
      {error && <span style={{ color: "var(--brand-red)", fontWeight: 700, width: "100%", textAlign: "center" }}>{error}</span>}
    </div>
  );
}
