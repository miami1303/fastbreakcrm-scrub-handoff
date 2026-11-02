"use client";

import { useMemo, useState } from "react";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import { CardCvcElement, CardExpiryElement, CardNumberElement, Elements, useElements, useStripe } from "@stripe/react-stripe-js";

const cache = new Map<string, Promise<Stripe | null>>();

function stripePromise(publishableKey: string) {
  let found = cache.get(publishableKey);
  if (!found) {
    found = loadStripe(publishableKey);
    cache.set(publishableKey, found);
  }
  return found;
}

export type CardIntent = { clientSecret: string; intentType: "payment" | "setup" };

const FIELD_STYLE = { base: { fontSize: "14px", color: "#1a1a1a", "::placeholder": { color: "#8a8f98" } }, invalid: { color: "#b00020" } };

/**
 * Phone card entry. The rep types the card number, expiration, and security code into
 * Stripe's own fields (the CRM never sees the full number). "Save Card" stores it on the
 * customer in Stripe (recalled later as brand ••••last4 exp). "Charge Now" charges the
 * amount in the form and also saves the card for later. Nothing is marked paid until the
 * server reads the result back from Stripe.
 */
export default function StripeCardBox(props: {
  publishableKey: string;
  cardholderName: string;
  billingZip: string;
  email: string | null;
  phone: string | null;
  chargeLabel: string;
  canCharge: boolean;
  busy: boolean;
  /** Server step: creates the SetupIntent (save) or PaymentIntent (charge). Null = stop (message already shown). */
  prepare: (kind: "save" | "charge") => Promise<CardIntent | null>;
  /** Server step after Stripe confirmed the card in the browser. */
  finish: (kind: "save" | "charge") => Promise<void>;
  /** Stripe refused the card in the browser. The parent closes the waiting intent. */
  fail: (kind: "save" | "charge", message: string) => Promise<void>;
}) {
  const stripe = useMemo(() => stripePromise(props.publishableKey), [props.publishableKey]);
  return (
    <div className="stripe-box" data-testid="stripe-card-box">
      <Elements stripe={stripe}>
        <CardForm {...props} />
      </Elements>
    </div>
  );
}

function CardForm({ cardholderName, billingZip, email, phone, chargeLabel, canCharge, busy, prepare, finish, fail }: Parameters<typeof StripeCardBox>[0]) {
  const stripe = useStripe();
  const elements = useElements();
  const [working, setWorking] = useState<"save" | "charge" | null>(null);
  const [name, setName] = useState(cardholderName);
  const [zip, setZip] = useState(billingZip);
  const [complete, setComplete] = useState({ number: false, expiry: false, cvc: false });
  const [fieldError, setFieldError] = useState<string | null>(null);
  const ready = complete.number && complete.expiry && complete.cvc;

  async function run(kind: "save" | "charge") {
    if (!stripe || !elements) return;
    const card = elements.getElement(CardNumberElement);
    if (!card) return;
    if (!ready) { setFieldError("Enter the card number, expiration, and security code first. Nothing was charged."); return; }
    setFieldError(null);
    setWorking(kind);
    try {
      const intent = await prepare(kind);
      if (!intent) return;
      const payment_method = {
        card,
        billing_details: {
          name: name.trim() || undefined,
          email: email || undefined,
          phone: phone || undefined,
          address: zip.trim() ? { postal_code: zip.trim() } : undefined,
        },
      };
      const result = intent.intentType === "setup"
        ? await stripe.confirmCardSetup(intent.clientSecret, { payment_method })
        : await stripe.confirmCardPayment(intent.clientSecret, { payment_method });
      if (result.error) {
        await fail(kind, result.error.message || "Stripe did not accept the card. Nothing was marked paid.");
        return;
      }
      const status = "paymentIntent" in result ? result.paymentIntent?.status : result.setupIntent?.status;
      if (status !== "succeeded") {
        await fail(kind, "Stripe has not confirmed this yet. It was not marked paid.");
        return;
      }
      await finish(kind);
      card.clear();
      elements.getElement(CardExpiryElement)?.clear();
      elements.getElement(CardCvcElement)?.clear();
    } finally {
      setWorking(null);
    }
  }

  const disabled = busy || !!working || !stripe;
  return (
    <div className="stripe-box-inner" data-testid="phone-card-entry">
      <label className="pf-row"><span>Cardholder Name</span><input value={name} onChange={e => setName(e.target.value)} autoComplete="off" data-testid="pay-cardholder" /></label>
      <div className="pf-row"><span>Card Number</span><div className="stripe-field" data-testid="pay-card"><CardNumberElement options={{ style: FIELD_STYLE, showIcon: true, disableLink: true }} onChange={e => setComplete(c => ({ ...c, number: e.complete }))} /></div></div>
      <div className="pf-row"><span>Expiration</span><div className="stripe-field short" data-testid="pay-exp"><CardExpiryElement options={{ style: FIELD_STYLE }} onChange={e => setComplete(c => ({ ...c, expiry: e.complete }))} /></div></div>
      <div className="pf-row"><span>Security Code</span><div className="stripe-field short" data-testid="pay-cvv"><CardCvcElement options={{ style: FIELD_STYLE }} onChange={e => setComplete(c => ({ ...c, cvc: e.complete }))} /></div></div>
      <label className="pf-row"><span>Billing ZIP</span><input value={zip} onChange={e => setZip(e.target.value)} inputMode="numeric" maxLength={10} className="short" data-testid="pay-zip" /></label>
      {fieldError && <p className="status-msg error">{fieldError}</p>}
      <div className="pf-actions">
        <button type="button" className="btn btn-primary" disabled={disabled} onClick={() => void run("save")} data-testid="save-card"
          title="Saves this card on the customer (Stripe). Recalled later as brand ••••last4. Does not charge.">
          {working === "save" ? "Saving with Stripe…" : "Save Card"}
        </button>
        <button type="button" className="btn btn-charge-now" disabled={disabled || !canCharge} onClick={() => void run("charge")} data-testid="charge-new-card"
          title={canCharge ? "Charge the Amount in the form to this card now (the card is also saved for later)" : "Enter the Amount first"}>
          {working === "charge" ? "Charging with Stripe…" : chargeLabel}
        </button>
      </div>
      <p className="pf-note">Card number, exp, and CVV go straight to Stripe and are not stored in the CRM. Saved cards are recalled below by brand, last 4, and exp.</p>
    </div>
  );
}
