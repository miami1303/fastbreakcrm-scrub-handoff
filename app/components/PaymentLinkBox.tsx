"use client";

// One Payment Link sender, used on the Payments tab and in the Email Center, so both look and work
// the same: one-click Deposit / Balance amounts (no counting), or type another amount, then Send.
// The email is logged in the Email Center (Previous Emails) and tracked like every other CRM email.
import { useEffect, useState } from "react";
import { paymentLinkSetup, sendPaymentLink } from "@/app/actions/stripe-payments";
import type { MethodLine } from "@/lib/payment-methods";
import { centsInput, centsLabel, paymentLinkChoices, type LinkPayment } from "@/lib/payment-link-amounts";

const SMS_PENDING = "Texting turns on when the SMS API keys are added (SMS_PROVIDER / TWILIO_* in Vercel).";

export function PaymentLinkBox({ estimateId, totalAmount, depositAmount, payments, stripeOn, optedOut = false, hasEmail = true, hasPhone = true, compact = false, onSent, readAmount, writeAmount }: {
  estimateId: string;
  totalAmount: number | string | null | undefined;
  depositAmount: number | string | null | undefined;
  payments: LinkPayment[];
  stripeOn: boolean;
  optedOut?: boolean;
  hasEmail?: boolean;
  /** The lead has a phone number to text. */
  hasPhone?: boolean;
  /**
   * Payments tab: the link uses the payment form's own Amount + Deposit fields (one amount field,
   * no re-typing). The chips fill those fields; Email / Text read them.
   */
  readAmount?: () => { amount: string; isDeposit: boolean };
  writeAmount?: (amount: string, isDeposit: boolean) => void;
  /** Email Center row: chips only, result on one line. */
  compact?: boolean;
  /** After a link was created (emailed or not): the message the rep should see. */
  onSent?: (message: string, emailed: boolean) => void;
}) {
  const choices = paymentLinkChoices({ totalAmount, depositAmount, payments });
  const [amount, setAmount] = useState(() => (choices[0] ? centsInput(choices[0].cents) : ""));
  const [isDeposit, setIsDeposit] = useState(() => !!choices[0]?.isDeposit);
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string; url?: string; mailto?: string | null } | null>(null);
  const [copied, setCopied] = useState(false);
  const [sms, setSms] = useState<boolean | null>(null);
  const [methods, setMethods] = useState<MethodLine[]>([]);
  useEffect(() => { paymentLinkSetup().then(r => { setSms(r.sms); setMethods(r.methods); }).catch(() => setSms(false)); }, []);
  const blocked = !stripeOn ? "Payments aren't set up. Call us to enable payments." : optedOut ? "Customer opted out of email." : !hasEmail ? "Add the customer's email first." : "";
  const textBlocked = !stripeOn ? "Payments aren't set up. Call us to enable payments." : sms === false ? SMS_PENDING : sms === null ? "Checking…" : !hasPhone ? "Add the customer's phone first." : "";

  async function send(cents?: number, deposit?: boolean, channel: "email" | "text" = "email") {
    const fromForm = cents === undefined && readAmount ? readAmount() : null;
    const value = cents !== undefined ? centsInput(cents) : fromForm ? fromForm.amount : amount;
    if (fromForm) deposit = fromForm.isDeposit;
    if (!value.trim()) { setResult({ ok: false, text: "Enter the amount in Amount above (or pick Deposit / Balance). Nothing was sent." }); return; }
    const data = new FormData();
    data.set("amount", value);
    data.set("channel", channel);
    if (deposit ?? isDeposit) data.set("is_deposit", "on");
    data.set("idempotency_key", key);
    setBusy(true);
    const r = await sendPaymentLink(estimateId, data);
    setBusy(false);
    if (!r.ok) {
      if (r.newKey) setKey(crypto.randomUUID());
      setResult({ ok: false, text: r.error });
      return;
    }
    setKey(crypto.randomUUID());
    const delivered = channel === "text" ? !!r.texted : r.emailed;
    setResult({ ok: delivered, text: r.message, url: r.url, mailto: r.mailto });
    onSent?.(r.message, delivered);
  }

  async function copy() {
    if (!result?.url) return;
    try { await navigator.clipboard.writeText(result.url); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* clipboard blocked */ }
  }

  const resultRow = result && (
    <span className={`plb-result${result.ok ? " ok" : " err"}`} data-testid="plb-result">
      {result.text}
      {result.url && <> <button type="button" className="link-btn" onClick={copy} data-testid="plb-copy">{copied ? "Copied ✓" : "Copy link"}</button></>}
      {result.mailto && !result.ok && <> · <a href={result.mailto}>Open mail draft</a></>}
    </span>
  );

  if (compact) {
    return (
      <span className="plb plb-compact" data-testid="plb-compact">
        <span className="plb-chips">
          {choices.map(ch => (
            <button key={ch.key} type="button" className="ec-opt" disabled={busy || !!blocked} title={blocked || `Email a ${centsLabel(ch.cents)} payment link`}
              onClick={() => { if (window.confirm(`Email a ${ch.label.toLowerCase()} payment link for ${centsLabel(ch.cents)}?`)) void send(ch.cents, ch.isDeposit); }} data-testid={`plb-send-${ch.key}`}>
              {busy ? "Sending…" : `${ch.label} ${centsLabel(ch.cents)}`}
            </button>
          ))}
          <button type="button" className="ec-opt" disabled={busy || !!textBlocked || !choices[0]} title={textBlocked || "Text the payment link"}
            onClick={() => { const ch = choices[0]; if (ch && window.confirm(`Text a ${ch.label.toLowerCase()} payment link for ${centsLabel(ch.cents)}?`)) void send(ch.cents, ch.isDeposit, "text"); }} data-testid="plb-text-compact">
            {sms === false ? "Text (API pending)" : "Text"}
          </button>
          <a className="ec-opt" href={`/estimates/${estimateId}/payments#payment-link`} data-testid="open-payment-link" title="Another amount (Payments tab)">Other…</a>
        </span>
        {resultRow}
      </span>
    );
  }

  return (
    <div className="plb" id="payment-link" data-testid="payment-link-box">
      <div className="plb-head">All Payment Methods <small className="muted">one Stripe link (card, Cash App, PayPal…) + Zelle direct</small></div>
      <ul className="plb-methods" data-testid="plb-methods">
        {methods.filter(m => m.via === "stripe").length > 0 && (
          <li><b>Stripe link</b><span>{methods.filter(m => m.via === "stripe").map(m => m.method).join(" · ")} · one secure link, sent by Email / Text below</span></li>
        )}
        {methods.filter(m => m.via === "direct").map(m => (
          <li key={m.method} data-testid="plb-zelle"><b>{m.method}</b><span>Direct to Fast Break (not Stripe): {m.detail || "no address set"} · record it with Update Payment</span></li>
        ))}
        <li><b>Venmo</b><span>Not offered by Stripe yet. It turns on when Stripe adds it.</span></li>
      </ul>
      {choices.length > 0 && (
        <div className="plb-chips" role="group" aria-label="Payment link amount">
          {choices.map(ch => {
            const on = !writeAmount && amount === centsInput(ch.cents) && isDeposit === ch.isDeposit;
            return <button key={ch.key} type="button" className={`plb-chip${on ? " on" : ""}`} aria-pressed={on}
              onClick={() => { if (writeAmount) writeAmount(centsInput(ch.cents), ch.isDeposit); else { setAmount(centsInput(ch.cents)); setIsDeposit(ch.isDeposit); } }}
              title={writeAmount ? "Puts this amount in the payment form's Amount" : undefined} data-testid={`plb-pick-${ch.key}`}>{ch.label} {centsLabel(ch.cents)}</button>;
          })}
        </div>
      )}
      {readAmount ? <p className="pf-note" data-testid="plb-uses-form">Uses the Amount and Payment Deposit set in the form above.</p> : (
        <div className="plb-row">
          <span className="money-in">$<input value={amount} inputMode="decimal" placeholder="0.00" aria-label="Payment link amount" onChange={e => setAmount(e.target.value)} data-testid="plb-amount" /></span>
          <label className="plb-dep"><input type="checkbox" checked={isDeposit} onChange={e => setIsDeposit(e.target.checked)} data-testid="plb-deposit" /> Deposit</label>
        </div>
      )}
      <div className="plb-row plb-send">
        <button type="button" className="btn btn-primary" disabled={busy || !!blocked || (!readAmount && !amount)} title={blocked || "Email the payment link + all payment methods (logged in the Email Center)"} onClick={() => void send()} data-testid="send-payment-link">{busy ? "Sending…" : "✉ Email"}</button>
        <button type="button" className="btn" disabled={busy || !!textBlocked || (!readAmount && !amount)} title={textBlocked || "Text the payment link to the customer's phone"} onClick={() => void send(undefined, undefined, "text")} data-testid="text-payment-link">
          {sms === false ? "💬 Text (API pending)" : "💬 Text"}
        </button>
      </div>
      {blocked && <p className="pf-note">{blocked}</p>}
      {sms === false && <p className="pf-note" data-testid="plb-sms-pending">{SMS_PENDING}</p>}
      {resultRow}
    </div>
  );
}
