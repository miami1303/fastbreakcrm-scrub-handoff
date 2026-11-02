"use client";

// PAYMENTS tab. Update Payment only writes the ledger. Stripe charges go through the
// secure card box and only when Stripe keys are configured. A negative amount is a
// bookkeeping correction and never charges or refunds.
// Auto-charge is the shared green switch. It saves the existing auto_charge_enabled flag.
// Return to customer / Return to carrier (Owner 2026-10-31): two checkboxes next to Payment Deposit.
// When one is checked, Charge Now / Hold / Update Payment turn red and become Refund Now.
//   customer -> Stripe refund to the card (or Cash App Pay) of a confirmed charge on this job.
//   carrier  -> Zelle direct from Fast Break (queued ASAP, never Stripe) or Cash App via Stripe Connect.
import { useEffect, useRef, useState } from "react";
import { addPayment, revealPayment, voidPayment, type PaymentDetails } from "@/app/actions/payments";
import {
  beginStripeCard, cancelIncompletePayment, finalizeStripePayment, finishCardSave, linkPaymentCustomer, linkPaymentLead,
  loadPaymentExtras, returnToCustomer, searchPaymentCustomers, setAutoCharge, startCardSave, type ChargeReceipt,
} from "@/app/actions/stripe-payments";
import Toggle from "@/app/components/Toggle";
import { cancelQueuedZelle, inviteCarrierToStripe, listCarrierPayouts, markZelleSent, refundCarrier, type CarrierPayout } from "@/app/actions/carrier-payouts";
import { pendingPayments } from "@/lib/payments/pending";
import { CARRIER_PAYOUT_METHODS, actionButtons, accountingSummary, carrierStatusLabel, isCustomerRefund, cleanStripeAccount, cleanZelleRecipient, nextReturnMode, zelleToSend, type ReturnMode } from "@/lib/payments/returns";
import { PaymentLinkBox } from "@/app/components/PaymentLinkBox";
import { STRIPE_HINT } from "@/lib/auto-charge";
import DatePopup from "@/app/components/DatePopup";
import CarrierOwesBox, { type CarrierOwesEst } from "@/app/components/CarrierOwesBox";
import { carrierOwesState, carrierSettlement, type CarrierOwesInput } from "@/lib/carrier-owes";
import { CARD_TYPE_OPTIONS, cardWarnings, confidentCardType, detectCardType } from "@/lib/card-type";
import { isUsZip, lookupZip } from "@/lib/zip-lookup";
import { formatCents, toCents } from "@/lib/money";
import { todayChicago } from "@/lib/calendar";
import { crmDate, crmStamp } from "@/lib/crm-time";
import { PAYMENT_METHODS } from "@/lib/crm-constants";
import { countsAsPaid } from "@/lib/payments/decide";
import { parseAddress } from "@/app/components/AddressFields";
import PhoneNumberInput from "@/app/components/PhoneNumberInput";
import { phoneForField } from "@/lib/phone-format";
import StripeCardBox, { type CardIntent } from "./stripe-card-box";
import type { Lead } from "./lead-context";
import { jobMoney, paymentsByVehicle, savedChargeLines } from "@/lib/vehicle-charges";
import { vehicleDisplayName } from "@/lib/vehicle-pricing";

const pad = (n: number) => String(n).padStart(2, "0");
/** TRNO = running number per job, oldest first: 001-FB, 002-FB … */
export const trno = (n: number) => `${pad(n).padStart(3, "0")}-FB`;
const MONTHS = Array.from({ length: 12 }, (_, i) => pad(i + 1));

type Extras = Extract<Awaited<ReturnType<typeof loadPaymentExtras>>, { ok: true }>;
type SearchHit = Extract<Awaited<ReturnType<typeof searchPaymentCustomers>>, { ok: true }>["hits"][number];

export default function PaymentsPanel({ lead, onChanged }: { lead: Lead; onChanged: () => void }) {
  const pickup = parseAddress(lead.est.pickup_address, lead.est.pickup_zip);
  const thisYear = +todayChicago().slice(0, 4);
  const formRef = useRef<HTMLFormElement>(null);
  const [city, setCity] = useState(pickup.city);
  const [state, setState] = useState(pickup.state);
  const [phone, setPhone] = useState(() => phoneForField(lead.est.customer_phone || ""));
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const [saving, setSaving] = useState(false);
  const [details, setDetails] = useState<(PaymentDetails & { trno: string }) | null>(null);
  const [formKey, setFormKey] = useState(0);
  const [payDate, setPayDate] = useState(todayChicago());
  const [method, setMethod] = useState<string>("Credit Card");
  const [expM, setExpM] = useState("");
  const [expY, setExpY] = useState("");
  const [cardNumber, setCardNumber] = useState("");
  const [cvv, setCvv] = useState("");
  const [typeChoice, setTypeChoice] = useState<string | null>(null);
  const [extras, setExtras] = useState<Extras | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [autoOn, setAutoOn] = useState(false);
  const [selectedCard, setSelectedCard] = useState<string | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  // The card typed by phone into Stripe's fields: which server intent is waiting on it.
  const pendingCard = useRef<{ kind: "save"; setupIntentId: string } | { kind: "charge"; idempotencyKey: string; amountCents: number } | null>(null);
  const [extrasTick, setExtrasTick] = useState(0);
  const [amountTyped, setAmountTyped] = useState("");
  const [chargeResult, setChargeResult] = useState<{ ok: boolean; text: string; receipt?: ChargeReceipt; at: string } | null>(null);
  const [refundKey, setRefundKey] = useState(() => crypto.randomUUID());
  const [refundFrom, setRefundFrom] = useState("");
  const [refundResult, setRefundResult] = useState<{ ok: boolean; text: string; amountCents?: number; refundId?: string; paymentIntentId?: string } | null>(null);
  const [isDeposit, setIsDeposit] = useState(true);
  const [returnMode, setReturnMode] = useState<ReturnMode>("none");
  const [carrierMethod, setCarrierMethod] = useState<string>("Zelle");
  const [carrierSource, setCarrierSource] = useState<"deposit" | "cod">("deposit");
  const [carrierName, setCarrierName] = useState("");
  const [carrierPayTo, setCarrierPayTo] = useState("");
  const [carrierEmail, setCarrierEmail] = useState("");
  const [carrierKey, setCarrierKey] = useState(() => crypto.randomUUID());
  const [carrierResult, setCarrierResult] = useState<{ ok: boolean; text: string; link?: string } | null>(null);
  const [payouts, setPayouts] = useState<CarrierPayout[]>([]);
  const [payoutsReady, setPayoutsReady] = useState(true);
  const [payoutsTick, setPayoutsTick] = useState(0);
  const [zelleConf, setZelleConf] = useState<Record<string, string>>({});
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const detected = detectCardType(cardNumber);
  const confident = confidentCardType(cardNumber);
  const repPicked = !!typeChoice;
  const cardType = repPicked ? typeChoice! : confident ?? "";
  const warnings = cardWarnings(cardNumber, cvv, cardType);
  const totalC = toCents(lead.quote?.total_amount) ?? 0;
  const owes = carrierOwesState(lead.est as unknown as Parameters<typeof carrierOwesState>[0]);
  const paidC = Math.round(lead.paidAmount * 100);
  const ordered = [...lead.payments].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const numberOf = (id: string) => trno(ordered.findIndex(p => p.id === id) + 1);
  const nameOf = (userId: string | null) => (userId && lead.reps.find(r => r.user_id === userId)?.name) || (userId ? "Admin" : "");
  const stripeOn = extras?.stripe.connected === true;
  const showLegacyCard = method === "Credit Card" && !stripeOn;
  const selected = extras?.cards.find(card => card.id === selectedCard) || null;
  // Charge Now uses the card on file: the one picked below, else the newest saved card.
  const onFile = selected || extras?.cards[0] || null;

  useEffect(() => {
    if (!details) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setDetails(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [details]);

  useEffect(() => {
    const pay = new URLSearchParams(window.location.search).get("pay");
    if (pay === "return") setMsg({ text: "You came back from the card page. That does not mark this payment paid. It is paid only after Stripe confirms it." });
    if (pay === "cancel") setMsg({ text: "The card page was closed. Nothing was marked paid." });
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadPaymentExtras(lead.est.id).then(result => {
      if (cancelled) return;
      if (!result.ok) {
        setExtras(null);
        setBanner(result.error);
        return;
      }
      setExtras(result);
      setAutoOn(result.autoCharge);
      setBanner(null);
    }).catch(() => {
      if (!cancelled) setBanner("Stripe status could not be checked. Update Payment still only records the ledger and does not charge a card.");
    });
    return () => { cancelled = true; };
  }, [lead.est.id, lead.payments.length, lead.est.lead_source, extrasTick]);

  useEffect(() => {
    let cancelled = false;
    listCarrierPayouts(lead.est.id).then(r => {
      if (cancelled || !r.ok) return;
      setPayouts(r.rows);
      setPayoutsReady(r.ready);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [lead.est.id, payoutsTick]);

  function stripeForm() {
    const form = formRef.current;
    if (!form) return null;
    const data = new FormData(form);
    data.set("auto_charge", autoOn ? "on" : "");
    if (vehicleFor) data.set("vehicle_index", vehicleFor);
    return data;
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (returnMode !== "none") { await refundNow(); return; }
    setSaving(true);
    const result = await addPayment(lead.est.id, new FormData(e.currentTarget));
    setSaving(false);
    if (!result.ok) return setMsg({ text: result.error, error: true });
    setMsg({ text: "Payment saved. This is a ledger record. It was not charged through Stripe." });
    setFormKey(k => k + 1);
    setAmountTyped("");
    setCardNumber(""); setCvv(""); setTypeChoice(null); setExpM(""); setExpY(""); setPayDate(todayChicago());
    setPhone(phoneForField(lead.est.customer_phone || ""));
    setIsDeposit(true);
    onChanged();
  }

  async function open(id: string) {
    const result = await revealPayment(id);
    if (!result.ok) return setMsg({ text: result.error, error: true });
    setDetails({ ...result.payment, trno: numberOf(id) });
  }

  async function toggleAuto(next: boolean) {
    setAutoOn(next);
    const result = await setAutoCharge(lead.est.id, next);
    if (!result.ok) {
      setAutoOn(!next);
      setMsg({ text: result.error, error: true });
      return;
    }
    setMsg({ text: result.message });
    onChanged();
  }

  function showChargeResult(ok: boolean, text: string, receipt?: ChargeReceipt) {
    setChargeResult({ ok, text, receipt, at: crmStamp(new Date().toISOString()) });
  }

  async function startCharge(savedCardId: string | null, chargeNow = false) {
    if (!savedCardId) {
      setMsg({ text: "Type the card in Credit Card Information on the right and click Charge Now there, or pick a saved card below. Nothing was charged.", error: true });
      document.querySelector<HTMLElement>("[data-testid=phone-card-entry]")?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    if (!stripeOn) {
      setMsg({ text: "Stripe is not connected yet. Nothing was charged. Use Update Payment to record a ledger entry, or log Zelle, Cash App, or PayPal.", error: true });
      return;
    }
    const data = stripeForm();
    if (!data) return;
    data.set("idempotency_key", idempotencyKey);
    if (savedCardId) data.set("saved_card_id", savedCardId);
    const amountCents = toCents(data.get("amount"));
    if (chargeNow) {
      if (amountCents === null || amountCents <= 0) {
        setMsg({ text: "Enter the amount to charge first. Nothing was charged.", error: true });
        return;
      }
      const card = savedCardId ? extras?.cards.find(c => c.id === savedCardId) : null;
      const who = card ? `${card.brand} ••••${card.last4}` : "the card you enter in the secure Stripe box";
      const live = extras?.stripe.mode === "live" ? " This is LIVE and moves real money." : "";
      if (!window.confirm(`Charge ${formatCents(amountCents)} to ${who} now?${live}`)) return;
      data.set("charge_now", "on");
      setChargeResult(null);
    }
    setSaving(true);
    const result = await beginStripeCard(lead.est.id, data);
    setSaving(false);
    if (!result.ok) {
      if (result.newKey) setIdempotencyKey(crypto.randomUUID());
      setMsg({ text: result.error, error: true });
      if (chargeNow) showChargeResult(false, result.error, result.receipt);
      return;
    }
    if (result.clientSecret && result.intentType) {
      // A saved-card charge never needs the card typed again. If Stripe still asks for it,
      // close the attempt so nothing is left waiting.
      await cancelIncompletePayment(lead.est.id, idempotencyKey);
      setIdempotencyKey(crypto.randomUUID());
      setMsg({ text: "Stripe asked for the card again. Type it in Credit Card Information on the right, then click Charge Now there. Nothing was charged.", error: true });
      onChanged();
      return;
    }
    if (chargeNow || result.receipt) showChargeResult(result.charged, result.message, result.receipt);
    if (!result.pending) setIdempotencyKey(crypto.randomUUID());
    setMsg({ text: result.message, error: !result.charged && /not marked paid|nothing was charged/i.test(result.message) });
    onChanged();
  }

  async function prepareCard(kind: "save" | "charge"): Promise<CardIntent | null> {
    setMsg(null);
    if (kind === "save") {
      const result = await startCardSave(lead.est.id);
      if (!result.ok) { setMsg({ text: result.error, error: true }); return null; }
      pendingCard.current = { kind: "save", setupIntentId: result.setupIntentId };
      return { clientSecret: result.clientSecret, intentType: "setup" };
    }
    const data = stripeForm();
    if (!data) return null;
    const amountCents = toCents(data.get("amount"));
    if (amountCents === null || amountCents <= 0) { setMsg({ text: "Enter the Amount to charge first. Nothing was charged.", error: true }); return null; }
    const live = extras?.stripe.mode === "live" ? " This is LIVE and moves real money." : "";
    if (!window.confirm(`Charge ${formatCents(amountCents)} to the card you typed in?${live}`)) return null;
    const key = idempotencyKey;
    data.set("idempotency_key", key);
    data.set("charge_now", "on");
    data.delete("saved_card_id");
    setChargeResult(null);
    const result = await beginStripeCard(lead.est.id, data);
    if (!result.ok) {
      if (result.newKey) setIdempotencyKey(crypto.randomUUID());
      setMsg({ text: result.error, error: true });
      showChargeResult(false, result.error, result.receipt);
      return null;
    }
    if (!result.clientSecret || result.intentType !== "payment") {
      setIdempotencyKey(crypto.randomUUID());
      setMsg({ text: result.message });
      onChanged();
      return null;
    }
    pendingCard.current = { kind: "charge", idempotencyKey: key, amountCents };
    return { clientSecret: result.clientSecret, intentType: "payment" };
  }

  async function finishCard(kind: "save" | "charge") {
    const pending = pendingCard.current;
    pendingCard.current = null;
    if (!pending || pending.kind !== kind) return;
    if (pending.kind === "save") {
      const result = await finishCardSave(lead.est.id, pending.setupIntentId);
      setMsg({ text: result.ok ? result.message : result.error, error: !result.ok });
      if (result.ok) setSelectedCard(result.cardId);
      setExtrasTick(t => t + 1);
      onChanged();
      // Auto-charge on + an Amount typed + e-signs not done yet: hold that amount on the new card so
      // it is charged once both e-signs are complete (same as "Hold Amount on this card").
      const holdC = toCents(amountTyped) ?? 0;
      if (result.ok && autoOn && holdC > 0 && extras && !extras.esign.both) await startCharge(result.cardId);
      else if (result.ok && autoOn) setMsg({ text: `${result.message} Auto-charge is on: enter the Amount and click Hold Amount on this card so it charges after both e-signs.` });
      return;
    }
    const result = await finalizeStripePayment(lead.est.id, pending.idempotencyKey);
    setIdempotencyKey(crypto.randomUUID());
    setMsg({ text: result.ok ? result.message : result.error, error: !result.ok });
    showChargeResult(result.ok && result.charged, result.ok ? result.message : result.error, result.receipt);
    setExtrasTick(t => t + 1);
    onChanged();
  }

  async function failCard(kind: "save" | "charge", text: string) {
    const pending = pendingCard.current;
    pendingCard.current = null;
    if (pending?.kind === "charge") {
      await cancelIncompletePayment(lead.est.id, pending.idempotencyKey);
      setIdempotencyKey(crypto.randomUUID());
      showChargeResult(false, text, { amountCents: pending.amountCents, brand: null, last4: null, paymentIntentId: null });
      onChanged();
    }
    setMsg({ text: kind === "save" ? `${text} Nothing was saved.` : text, error: true });
  }

  const canRefund = lead.staff.role === "admin" || lead.staff.role === "supervisor";
  const refundable = lead.payments.filter(p => !p.voided_at && p.charge_status === "succeeded" && (toCents(p.amount) ?? 0) > 0 && /^pi_/.test(p.confirmation_no || ""));

  const fromId = refundFrom && refundable.some(p => p.id === refundFrom) ? refundFrom : refundable[refundable.length - 1]?.id || "";
  const fromCharge = refundable.find(p => p.id === fromId) || null;
  const buttons = actionButtons(returnMode, {
    cardLabel: returnMode === "customer" ? (fromCharge?.card_last4 ? `••••${fromCharge.card_last4}` : null) : onFile ? `${onFile.brand} ••••${onFile.last4}` : null,
    carrierMethod, carrierSource,
  });
  const openZelle = zelleToSend(payouts);
  // Per vehicle (saved values): Total = Deposit + COD + Additional charges - Discount; carrier
  // collects COD + charges marked "Carrier COD". Customer payments are split by vehicle_index.
  const savedVehicles = lead.vehicles.map(v => v as typeof v & { deposit_amount?: unknown; cod_amount?: unknown; extra_charges?: unknown; discount_amount?: unknown });
  const perVehicle = !!lead.features.vehicleCharges && savedVehicles.length > 0;
  const vjm = jobMoney(savedVehicles.map(v => ({ deposit: v.deposit_amount, cod: v.cod_amount, charges: savedChargeLines(v.extra_charges), discount: v.discount_amount })));
  const paidBy = paymentsByVehicle(lead.payments.map(p => ({ amount: p.amount, vehicle_index: (p as { vehicle_index?: number | null }).vehicle_index ?? null, voided_at: p.voided_at, counts: countsAsPaid(p.charge_status) })), savedVehicles.length);
  const multiVehicle = perVehicle && savedVehicles.length > 1 && !!lead.features.paymentVehicle;
  const [vehicleFor, setVehicleFor] = useState("");
  const baseCodC = toCents(lead.quote?.cod_amount ?? lead.est.cod_amount) ?? 0;
  const acct = accountingSummary({ payments: lead.payments, carrier: payouts, totalAmount: lead.quote?.total_amount, codAmount: (baseCodC + (perVehicle ? vjm.extrasCodC : 0)) / 100 });
  // Planned settlement with Carrier owes: staff Payments menu only (customer documents never use it).
  const settle = carrierSettlement({ ...(lead.est as unknown as CarrierOwesInput), deposit: lead.quote?.deposit_amount ?? lead.est.deposit_amount, cod: lead.quote?.cod_amount ?? lead.est.cod_amount });
  // Pending (not charged yet): shows in Payment Records + the summary, never in Customer Payments.
  const pending = pendingPayments({ payments: lead.payments, cards: extras?.cards, depositDue: lead.quote?.deposit_amount ?? lead.est.deposit_amount, depositPaidC: acct.depositPaidC, totalAmount: lead.quote?.total_amount ?? lead.est.total_amount, customerPaidC: acct.customerPaidC });

  function pickReturn(which: "customer" | "carrier", checked: boolean) {
    const next = nextReturnMode(returnMode, which, checked);
    setReturnMode(next);
    if (next !== "none") setIsDeposit(false);
    setRefundResult(null); setCarrierResult(null);
  }

  /** Refund Now: the red button while Return to customer or Return to carrier is checked. */
  async function refundNow() {
    const form = formRef.current;
    const amountRaw = String((form?.elements.namedItem("amount") as HTMLInputElement | null)?.value || "");
    const reason = String((form?.elements.namedItem("remark") as HTMLInputElement | null)?.value || "");
    const cents = toCents(amountRaw);
    if (returnMode === "customer") {
      if (!canRefund) return setRefundResult({ ok: false, text: "Only an admin or supervisor can refund a customer. Nothing was refunded." });
      if (!stripeOn) return setRefundResult({ ok: false, text: "Stripe is not connected. Nothing was refunded." });
      if (!fromCharge) return setRefundResult({ ok: false, text: "No Stripe-confirmed charge on this job to refund. Nothing was refunded." });
      if (cents === null || cents <= 0) return setRefundResult({ ok: false, text: "Enter the Amount to refund. Nothing was refunded." });
      if (!window.confirm(`Refund ${formatCents(cents)} to the customer${fromCharge.card_last4 ? `'s card ••••${fromCharge.card_last4}` : ""} through Stripe now? Real money goes back and it comes off Customer Payments.`)) return;
      const data = new FormData();
      data.set("payment_id", fromCharge.id);
      data.set("amount", amountRaw);
      data.set("reason", reason);
      data.set("idempotency_key", refundKey);
      setSaving(true);
      const result = await returnToCustomer(lead.est.id, data);
      setSaving(false);
      if (!result.ok) {
        if (result.newKey) setRefundKey(crypto.randomUUID());
        setRefundResult({ ok: false, text: result.error });
        return;
      }
      setRefundKey(crypto.randomUUID());
      setRefundResult({ ok: true, text: result.message, amountCents: result.receipt.amountCents, refundId: result.receipt.refundId, paymentIntentId: result.receipt.paymentIntentId });
      setReturnMode("none"); setFormKey(k => k + 1); setAmountTyped(""); setIsDeposit(true);
      onChanged();
      return;
    }
    if (returnMode === "carrier") {
      if (!canRefund) return setCarrierResult({ ok: false, text: "Only an admin or supervisor can return money to a carrier. Nothing was sent." });
      if (cents === null || cents <= 0) return setCarrierResult({ ok: false, text: "Enter the Amount to return to the carrier. Nothing was sent." });
      const cod = carrierSource === "cod";
      const to = cod ? "COD" : carrierMethod === "Zelle" ? cleanZelleRecipient(carrierPayTo) : cleanStripeAccount(carrierPayTo);
      if (!to) return setCarrierResult({ ok: false, text: carrierMethod === "Zelle" ? "Enter the carrier's Zelle email or 10-digit mobile number. Nothing was sent." : "Enter the carrier's Stripe payout account (acct_…), or Invite carrier to Stripe first. Nothing was sent." });
      const how = cod
        ? `Add ${formatCents(cents)} to the carrier COD${carrierName ? ` (${carrierName})` : ""}? Nothing is taken from the deposit and no money is sent now.`
        : carrierMethod === "Zelle"
        ? `Queue a Zelle of ${formatCents(cents)} to ${to}${carrierName ? ` (${carrierName})` : ""} to send ASAP from Fast Break's bank? Stripe is not used for Zelle.`
        : `Send ${formatCents(cents)} to the carrier's Stripe payout account ${to} now (Cash App through Stripe)?${extras?.stripe.mode === "live" ? " This is LIVE and moves real money." : ""}`;
      if (!window.confirm(how)) return;
      const data = new FormData();
      data.set("amount", amountRaw);
      data.set("source", carrierSource);
      data.set("method", carrierMethod);
      data.set("carrier_name", carrierName);
      data.set("pay_to", carrierPayTo);
      data.set("reason", reason);
      data.set("idempotency_key", carrierKey);
      setSaving(true);
      const result = await refundCarrier(lead.est.id, data);
      setSaving(false);
      if (!result.ok) {
        if (result.newKey) setCarrierKey(crypto.randomUUID());
        setCarrierResult({ ok: false, text: result.error });
        return;
      }
      setCarrierKey(crypto.randomUUID());
      setCarrierResult({ ok: true, text: result.message });
      setReturnMode("none"); setFormKey(k => k + 1); setAmountTyped(""); setIsDeposit(true);
      setPayoutsTick(t => t + 1);
      onChanged();
    }
  }

  async function zelleSent(id: string) {
    const result = await markZelleSent(lead.est.id, id, zelleConf[id] || "");
    setCarrierResult({ ok: result.ok, text: result.ok ? result.message : result.error });
    if (result.ok) setPayoutsTick(t => t + 1);
  }

  async function zelleCancel(id: string) {
    if (!window.confirm("Cancel this queued Zelle? Only do this if it was NOT sent from the bank app.")) return;
    const result = await cancelQueuedZelle(lead.est.id, id);
    setCarrierResult({ ok: result.ok, text: result.ok ? result.message : result.error });
    if (result.ok) setPayoutsTick(t => t + 1);
  }

  async function inviteCarrier() {
    const data = new FormData();
    data.set("carrier_name", carrierName);
    data.set("carrier_email", carrierEmail);
    setSaving(true);
    const result = await inviteCarrierToStripe(lead.est.id, data);
    setSaving(false);
    if (!result.ok) return setCarrierResult({ ok: false, text: result.error });
    setCarrierPayTo(result.accountId);
    setCarrierResult({ ok: true, text: result.message, link: result.url });
  }

  async function runSearch() {
    const result = await searchPaymentCustomers(lead.est.id, query);
    if (!result.ok) return setMsg({ text: result.error, error: true });
    setHits(result.hits);
  }

  async function linkHit(hit: SearchHit, cardId?: string) {
    const result = hit.kind === "customer" ? await linkPaymentCustomer(lead.est.id, hit.id) : await linkPaymentLead(lead.est.id, hit.id);
    if (!result.ok) return setMsg({ text: result.error, error: true });
    const card = cardId ? hit.cards.find(c => c.id === cardId) : null;
    setMsg({ text: card ? `Using ${card.brand} ••••${card.last4} ${card.exp} from ${hit.name || "that customer"}. Enter the Amount, then Charge Now, or leave Auto-charge on.` : result.message });
    if (cardId) setSelectedCard(cardId);
    setHits(null);
    setExtrasTick(t => t + 1);
    onChanged();
  }

  const modeClass = extras?.stripe.mode === "live" ? "live" : extras?.stripe.mode === "test" ? "test" : "off";

  return (
    <div className="pay" data-testid="payments">
      {modeClass === "off" && <p className="pf-note" data-testid="payments-not-setup">Payments aren&apos;t set up. Call us to enable payments. You can still save the card, view it (authorized roles), book, send documents and e-sign; run the card on your own merchant terminal and mark it charged.</p>}
      <div className="pay-bar">
        <span className="pay-balance" data-testid="pay-balance">Balance: {formatCents(totalC - paidC)}</span>
        <span className="pay-title">Payments</span>
        <span />
      </div>
      <div className="pay-summary" data-testid="pay-summary">
        <span>Total <b>{formatCents(acct.totalC)}</b></span>
        <span className="paid">Customer Payments <b data-testid="sum-paid">{formatCents(acct.customerPaidC)}</b></span>
        {acct.refundedC > 0 && <span className="ret-cust">Refunded to cust <b data-testid="sum-refunded">−{formatCents(acct.refundedC)}</b> <small className="muted">(already taken off Customer Payments)</small></span>}
        <span>Deposit paid <b data-testid="sum-deposit">{formatCents(acct.depositPaidC)}</b></span>
        {settle.paid && settle.owesC > 0 && <span data-testid="sum-deposit-carrier">+ Carrier paid <b>{formatCents(settle.owesC)}</b> = FB deposit bookkeeping <b data-testid="sum-deposit-company">{formatCents(acct.depositPaidC + settle.owesC)}</b></span>}
        {acct.carrierFromDepositC > 0 && <span className="ret-carrier">Returned to carrier from deposit <b data-testid="sum-carrier-deposit">−{formatCents(acct.carrierFromDepositC)}</b></span>}
        {acct.carrierFromDepositC > 0 && <span>Deposit kept <b data-testid="sum-deposit-kept">{formatCents(acct.depositKeptC)}</b></span>}
        {acct.codAddedC > 0 && <span className="ret-carrier">Added to carrier COD <b data-testid="sum-cod-added">+{formatCents(acct.codAddedC)}</b> · COD to carrier <b data-testid="sum-carrier-cod">{formatCents(acct.carrierCodC)}</b></span>}
        {perVehicle && vjm.extrasCodC > 0 && acct.codAddedC === 0 && <span>Carrier collects (COD + charges) <b data-testid="sum-carrier-collects">{formatCents(acct.carrierCodC)}</b></span>}
        <span className="bal">Balance <b data-testid="sum-balance">{formatCents(acct.balanceC)}</b></span>
        {pending.pendingC > 0 && <span className="pending" data-testid="sum-pending">Pending (not charged yet) <b>{formatCents(pending.pendingC)}</b> · Balance after pending <b data-testid="sum-balance-after">{formatCents(pending.balanceAfterC)}</b></span>}
        {owes.owesC > 0 && <span className={`owes${owes.paid ? " paid-off" : ""}`} data-testid="sum-carrier-owes">Carrier Owes <b>{formatCents(owes.owesC)}</b>{owes.paid ? " (paid)" : ""}</span>}
      </div>
      {/* Carrier Owes (Owner 2026-10-31): back office only. Not part of Total / Balance above. */}
      <CarrierOwesBox est={lead.est as unknown as CarrierOwesEst} onSaved={onChanged} />
      {settle.owesC > 0 && (
        <div className="pay-summary pay-settle" data-testid="pay-settlement">
          <span className="settle-title">Once completed (staff only — customer never sees this)</span>
          <span>Deposit <b>{formatCents(settle.depositC)}</b></span>
          <span>COD <b>{formatCents(settle.codC)}</b></span>
          <span className="owes">Carrier owes <b>{formatCents(settle.owesC)}</b>{settle.paid ? " (paid)" : ""}</span>
          <span data-testid="settle-now">{settle.paid
            ? <>Now: carrier paid. FB deposit <b>{formatCents(settle.fbDepositNowC)}</b> · Carrier COD <b>{formatCents(settle.carrierCodNowC)}</b></>
            : <>Now: FB deposit <b>{formatCents(settle.fbDepositNowC)}</b> · Carrier still owes <b>{formatCents(settle.stillOwesC)}</b></>}</span>
          {!settle.paid && <span data-testid="settle-after">After carrier pays: FB deposit <b>{formatCents(settle.fbDepositAfterC)}</b> · Carrier COD <b>{formatCents(settle.carrierCodAfterC)}</b></span>}
        </div>
      )}
      {multiVehicle && (
        <div className="pay-summary pay-vehicles" data-testid="pay-by-vehicle">
          {savedVehicles.map((v, i) => {
            const m = vjm.vehicles[i];
            const paid = paidBy.byVehicleC[i] ?? 0;
            return <span key={i} data-testid={`pay-vehicle-${i + 1}`}>{i + 1}. {vehicleDisplayName(v, i)}: Total <b>{formatCents(m.totalC)}</b> · Paid <b>{formatCents(paid)}</b> · Balance <b>{formatCents(m.totalC - paid)}</b>
              {m.totalC - paid > 0 && <button type="button" className="link-btn small" data-testid={`pay-vehicle-${i + 1}-fill`} onClick={() => {
                const a = formRef.current?.elements.namedItem("amount") as HTMLInputElement | null;
                const amt = ((m.totalC - paid) / 100).toFixed(2);
                if (a) { a.value = amt; a.focus(); setAmountTyped(amt); }
                setVehicleFor(String(i));
              }}>Use</button>}</span>;
          })}
          {paidBy.jobC !== 0 && <span data-testid="pay-vehicle-job">Not tied to a vehicle: <b>{formatCents(paidBy.jobC)}</b></span>}
        </div>
      )}
      <div className={`stripe-banner ${modeClass}`} data-testid="stripe-status">
        {banner || extras?.stripe.message || "Checking whether Stripe is connected…"}
        {extras?.schemaMessage ? ` ${extras.schemaMessage}` : ""}
        {stripeOn && extras && !extras.webhookConfigured ? " Stripe notifications are not verified yet because STRIPE_WEBHOOK_SECRET is missing. A payment is not marked paid from a notification until that secret is set." : ""}
      </div>
      <div className="pay-info"><span>Customer: <b>{lead.est.customer_name}</b></span><span>Job No: <b>{lead.est.job_number}</b></span></div>
      {extras && (
        <p className="pf-note" data-testid="esign-pay-status">
          Contract e-sign: {extras.esign.contractSigned ? "signed" : "not signed"}. Credit card form: {extras.esign.ccFormSigned ? "signed" : "not signed"}.
          {extras.esign.both ? " Both e-signs are complete." : " Auto-charge waits until both are signed on the e-sign page."}
          {extras.onlineBooking ? " This is an online booking. The auto-charge switch is for this booking." : ""}
        </p>
      )}

      <form key={formKey} ref={formRef} onSubmit={submit} autoComplete="off" className="pay-cards">
        <section className="pay-card" data-testid="pay-left">
          <h3 className="pay-card-title">Add/Update Payment</h3>
          <label className="pf-row"><span>Payment Date</span><DatePopup value={payDate} onChange={setPayDate} name="payment_date" label="Payment date" testId="pay-date" clearable={false} /></label>
          <label className="pf-row"><span>Payment Method</span>
            <select name="method" value={method} onChange={e => setMethod(e.target.value)} data-testid="pay-method">
              <option value="">— No method —</option>
              {PAYMENT_METHODS.map(item => <option key={item}>{item}</option>)}
            </select>
          </label>
          <div className="pf-row" data-testid="deposit-return-row"><span>Payment Deposit</span>
            <span className="pf-checks">
              <label className={`ret-check dep${isDeposit && returnMode === "none" ? " on" : ""}`} title="This payment counts toward the Deposit.">
                <input name="is_deposit" type="checkbox" checked={isDeposit && returnMode === "none"} disabled={returnMode !== "none"} onChange={e => setIsDeposit(e.target.checked)} aria-label="Payment Deposit" data-testid="pay-deposit" /> Deposit
              </label>
              <label className={`ret-check cust${returnMode === "customer" ? " on" : ""}`} title="Refund the customer through Stripe (card or Cash App Pay). Admin or supervisor only.">
                <input type="checkbox" checked={returnMode === "customer"} onChange={e => pickReturn("customer", e.target.checked)} disabled={!canRefund} data-testid="return-cust-check" /> Return to customer
              </label>
              <div className={`ret-check carrier${returnMode === "carrier" ? " on" : ""}`} title="Money to the carrier: from the deposit (Zelle direct / Cash App via Stripe), or added to the carrier COD. Admin or supervisor only.">
                <label className="ret-hit">
                  <input type="checkbox" checked={returnMode === "carrier"} onChange={e => pickReturn("carrier", e.target.checked)} disabled={!canRefund} data-testid="return-carrier-check" /> Return to carrier
                </label>
                {returnMode === "carrier" && (
                  <span className="seg mini" role="radiogroup" aria-label="Return to carrier mode" data-testid="carrier-source">
                    <button type="button" role="radio" aria-checked={carrierSource === "deposit"} className={carrierSource === "deposit" ? "on" : ""} onClick={() => setCarrierSource("deposit")} data-testid="carrier-source-deposit">From deposit</button>
                    <button type="button" role="radio" aria-checked={carrierSource === "cod"} className={carrierSource === "cod" ? "on" : ""} onClick={() => setCarrierSource("cod")} data-testid="carrier-source-cod">Add to COD</button>
                  </span>
                )}
              </div>
            </span>
          </div>
          {!canRefund && <p className="pf-note">Return to customer / carrier: admin or supervisor only.</p>}
          {returnMode === "customer" && (
            <div className="return-fields cust" data-testid="return-cust-fields">
              {refundable.length === 0
                ? <p className="pf-note" data-testid="refund-none">No Stripe-confirmed charge on this job to refund. {stripeOn ? "" : "Stripe is not connected."}</p>
                : <label className="pf-row"><span>Refund from</span>
                  <select value={fromId} onChange={e => setRefundFrom(e.target.value)} data-testid="refund-from">
                    {refundable.map(p => <option key={p.id} value={p.id}>{numberOf(p.id)} · {formatCents(toCents(p.amount) ?? 0)}{p.card_last4 ? ` · ••••${p.card_last4}` : ""}{p.method && p.method !== "Credit Card" ? ` · ${p.method}` : ""} · {p.confirmation_no}</option>)}
                  </select>
                </label>}
              <p className="pf-note">Amount below = how much to refund. Payment Remark = reason. Refund Now sends it back through Stripe and it comes off Customer Payments (the refund line stays in Payment Records).</p>
            </div>
          )}
          {returnMode === "carrier" && carrierSource === "cod" && (
            <div className="return-fields carrier" data-testid="return-carrier-fields">
              <label className="pf-row"><span>Carrier</span><input value={carrierName} onChange={e => setCarrierName(e.target.value)} maxLength={120} placeholder="Carrier name" data-testid="carrier-name" /></label>
              <p className="pf-note">Add to COD: the Amount is added to what the carrier collects at pickup/delivery, so the car gets picked up without taking anything from the deposit. No money is sent now. It is recorded in Payment Records.</p>
            </div>
          )}
          {returnMode === "carrier" && carrierSource === "deposit" && (
            <div className="return-fields carrier" data-testid="return-carrier-fields">
              <label className="pf-row"><span>Send by</span>
                <select value={carrierMethod} onChange={e => { setCarrierMethod(e.target.value); setCarrierPayTo(""); }} data-testid="carrier-method">
                  {CARRIER_PAYOUT_METHODS.map(m => <option key={m} value={m}>{m === "Zelle" ? "Zelle (direct from Fast Break)" : "Cash App (through Stripe)"}</option>)}
                </select>
              </label>
              <label className="pf-row"><span>Carrier</span><input value={carrierName} onChange={e => setCarrierName(e.target.value)} maxLength={120} placeholder="Carrier name" data-testid="carrier-name" /></label>
              {carrierMethod === "Zelle"
                ? <label className="pf-row"><span>Carrier Zelle</span><input value={carrierPayTo} onChange={e => setCarrierPayTo(e.target.value)} maxLength={160} placeholder="Carrier's Zelle email or mobile" data-testid="carrier-pay-to" /></label>
                : <>
                  <label className="pf-row"><span>Carrier Stripe acct</span><input value={carrierPayTo} onChange={e => setCarrierPayTo(e.target.value)} maxLength={80} placeholder="acct_…" data-testid="carrier-pay-to" /></label>
                  <div className="pf-row"><span>No account yet?</span><span className="pf-pair">
                    <input value={carrierEmail} onChange={e => setCarrierEmail(e.target.value)} type="email" placeholder="Carrier email" aria-label="Carrier email" data-testid="carrier-email" />
                    <button type="button" className="btn" disabled={saving || !stripeOn} onClick={() => void inviteCarrier()} data-testid="carrier-invite">Invite carrier to Stripe</button>
                  </span></div>
                </>}
              <p className="pf-note">{carrierMethod === "Zelle"
                ? "Out of the deposit. Zelle goes straight from Fast Break's bank; Stripe never touches it. Refund Now queues it ASAP below with the carrier's Zelle, amount and memo. Send it in the bank app, then Mark Zelle sent with the confirmation #."
                : "Out of the deposit. Cash App goes through Stripe: a Stripe transfer to the carrier's Stripe payout account, paid out to their bank or Cash App card."}</p>
            </div>
          )}
          <label className="pf-row"><span>Amount</span><input name="amount" inputMode="decimal" required placeholder="0.00" onChange={e => setAmountTyped(e.target.value)} data-testid="pay-amount" /></label>
          {multiVehicle && returnMode === "none" && (
            <label className="pf-row"><span>For vehicle</span>
              <select name="vehicle_index" value={vehicleFor} onChange={e => setVehicleFor(e.target.value)} data-testid="pay-vehicle">
                <option value="">Whole job (all vehicles)</option>
                {savedVehicles.map((v, i) => <option key={i} value={String(i)}>{i + 1}. {vehicleDisplayName(v, i)}</option>)}
              </select>
            </label>
          )}
          <div className={`pf-row auto-switch${autoOn ? " on" : ""}`} data-testid="auto-charge-row">
            <span>Auto-charge</span>
            <Toggle
              on={stripeOn && autoOn}
              disabled={!stripeOn || !extras?.schemaReady || saving || returnMode !== "none"}
              label={stripeOn ? "Auto-charge" : STRIPE_HINT}
              hint={returnMode !== "none" ? "Paused while a return is checked: nothing is charged." : stripeOn ? (autoOn ? "On. The saved card is charged only after both e-signs." : "Off. Charge the card yourself, or log Zelle, Cash App, or PayPal.") : undefined}
              testId="auto-charge"
              title="Charge the saved card once after the contract and the CC form are both e-signed"
              onChange={on => { void toggleAuto(on); }}
            />
          </div>
          <label className="pf-row"><span>Confirmation No.</span><input name="confirmation_no" maxLength={80} data-testid="pay-confirm" /></label>
          <label className="pf-row"><span>Payment Remark</span><input name="remark" maxLength={500} data-testid="pay-remark" /></label>
          <div className="pf-actions">
            {buttons.refund
              ? <button type="button" className={buttons.className} disabled={saving} onClick={() => void refundNow()} data-testid="charge-now" data-refund="on"
                  title="A return box is checked: this sends money back instead of charging">{saving ? "Working…" : buttons.chargeLabel}</button>
              : <button type="button" className="btn btn-charge-now" disabled={saving || !stripeOn || method !== "Credit Card"} onClick={() => startCharge(onFile?.id ?? null, true)} data-testid="charge-now"
                  title={onFile ? `Immediately charge the Amount to ${onFile.brand} ••••${onFile.last4} (card on file)` : "No card on file yet: type the card in Credit Card Information"}>
                  {saving ? "Working…" : onFile ? `Charge Now · ${onFile.brand} ••••${onFile.last4}` : "Charge Now"}
                </button>}
            <button type="submit" className={buttons.refund ? buttons.className : "btn btn-primary"} disabled={saving} data-testid="save-payment">{saving ? "Saving…" : buttons.saveLabel}</button>
          </div>
          <PaymentLinkBox estimateId={lead.est.id} totalAmount={lead.quote?.total_amount ?? lead.est.total_amount} depositAmount={lead.quote?.deposit_amount ?? lead.est.deposit_amount}
            payments={lead.payments} stripeOn={stripeOn} optedOut={!!lead.block} hasEmail={!!lead.est.customer_email} hasPhone={!!lead.est.customer_phone} onSent={(text, emailed) => { setMsg({ text, error: !emailed }); onChanged(); }}
            readAmount={() => {
              const f = formRef.current;
              const a = f?.elements.namedItem("amount") as HTMLInputElement | null;
              const d = f?.elements.namedItem("is_deposit") as HTMLInputElement | null;
              return { amount: a?.value || "", isDeposit: !!d?.checked };
            }}
            writeAmount={(amount, isDeposit) => {
              const f = formRef.current;
              const a = f?.elements.namedItem("amount") as HTMLInputElement | null;
              const d = f?.elements.namedItem("is_deposit") as HTMLInputElement | null;
              if (a) { a.value = amount; a.focus(); setAmountTyped(amount); }
              if (d) setIsDeposit(isDeposit);
            }} />
          <p className="pf-note">A negative amount only corrects the books (for example a deposit entered wrong). It does not charge, refund, or move money. To send money back, check Return to customer or Return to carrier next to Payment Deposit and click Refund Now.</p>
          {refundResult && (
            <div className={`charge-result ${refundResult.ok ? "ok" : "fail"}`} role="status" data-testid="refund-result">
              <b>{refundResult.ok ? "Refunded to customer" : "Not refunded"}</b>
              <div>{refundResult.text}</div>
              {refundResult.ok && <div className="charge-receipt">
                <span>Amount: <b>−{formatCents(refundResult.amountCents ?? 0)}</b></span>
                <span>Stripe refund: <code>{refundResult.refundId}</code></span>
                <span>From PI: <code>{refundResult.paymentIntentId}</code></span>
              </div>}
            </div>
          )}
          {carrierResult && (
            <div className={`charge-result ${carrierResult.ok ? "ok" : "fail"}`} role="status" data-testid="carrier-result">
              <b>{carrierResult.ok ? "Carrier return" : "Not sent"}</b><div>{carrierResult.text}</div>
              {carrierResult.link && <div><a href={carrierResult.link} target="_blank" rel="noreferrer" data-testid="carrier-invite-link">Carrier&apos;s secure Stripe onboarding link</a> <button type="button" className="link-btn" onClick={() => void navigator.clipboard?.writeText(carrierResult.link!)}>Copy</button></div>}
            </div>
          )}
          {msg && <p className={`status-msg${msg.error ? " error" : ""}`} data-testid="pay-msg">{msg.text}</p>}
          {chargeResult && (
            <div className={`charge-result ${chargeResult.ok ? "ok" : "fail"}`} role="status" data-testid="charge-result">
              <b>{chargeResult.ok ? "Charged" : "Not charged"}</b> <small className="muted">{chargeResult.at}</small>
              <div>{chargeResult.text}</div>
              {chargeResult.receipt && (
                <div className="charge-receipt">
                  <span>Amount: <b data-testid="charge-amount">{formatCents(chargeResult.receipt.amountCents)}</b></span>
                  <span>Card: <b data-testid="charge-last4">{chargeResult.receipt.last4 ? `${chargeResult.receipt.brand || "Card"} ••••${chargeResult.receipt.last4}` : "—"}</b></span>
                  <span>Stripe PI: <code data-testid="charge-pi">{chargeResult.receipt.paymentIntentId || "—"}</code></span>
                </div>
              )}
            </div>
          )}
          <p className="pf-note payout-note" data-testid="payout-schedule">
            <b>Daily batch:</b> Stripe pays out daily to Bank of America ••7577. A card charge is usually available about 2 days after the charge, then goes out in that day&apos;s payout; the bank deposit (ACH) usually lands 1–2 business days after the payout.
          </p>
        </section>

        <section className="pay-card" data-testid="pay-right">
          <div className="pay-tabs" role="tablist">
            <button type="button" role="tab" className="on" data-testid="pay-tab-card">Credit Card Information</button>
          </div>
          {stripeOn && method === "Credit Card" && <p className="pf-note" data-testid="cc-ledger-note">Update Payment records the Amount (for example a deposit run on the terminal) without charging a card. It shows on the customer side right away. To charge the card through Stripe, use Charge Now.</p>}
          {method !== "Credit Card" && <p className="pf-note">{method || "A payment with no method"} is logged by hand. Update Payment does not charge a card. It shows on the customer side right away.</p>}
          {returnMode !== "none" && <p className="pf-note" data-testid="return-mode-note">A return box is checked, so nothing here charges a card. Uncheck it to charge again.</p>}
          {stripeOn && method === "Credit Card" && returnMode === "none" && extras?.stripe.publishableKey && (
            <StripeCardBox
              publishableKey={extras.stripe.publishableKey}
              cardholderName={lead.est.customer_name || ""}
              billingZip={pickup.zip || ""}
              email={lead.est.customer_email || null}
              phone={lead.est.customer_phone || null}
              chargeLabel={(() => { const c = toCents(amountTyped); return c && c > 0 ? `Charge Now ${formatCents(c)}` : "Charge Now"; })()}
              canCharge={(toCents(amountTyped) ?? 0) > 0}
              busy={saving}
              prepare={prepareCard}
              finish={finishCard}
              fail={failCard}
            />
          )}
          {stripeOn && method === "Credit Card" && (
            <div className="saved-cards" data-testid="saved-cards">
              <h4 className="pay-card-title">Cards on file</h4>
              {(extras?.cards || []).length === 0 && <p className="pf-note" data-testid="no-saved-cards">{extras?.matchKind === "many" ? "More than one customer matches this name, phone, or email. Find the right person below to recall their card." : "No saved card on this customer yet. Type one above and click Save Card, or find a customer below."}</p>}
              <div className="card-bars">
                {(extras?.cards || []).map(card => (
                  <button type="button" key={card.id} className={`card-bar saved${selectedCard === card.id ? " selected" : ""}`} onClick={() => setSelectedCard(selectedCard === card.id ? null : card.id)} data-testid="saved-card-bar">
                    <span>{card.brand} ••••{card.last4} · exp {card.exp}</span>
                    <span>{card.originalJobNumber ? `job ${card.originalJobNumber}` : ""}{card.savedAt ? ` · saved ${crmStamp(card.savedAt)}` : ""}</span>
                  </button>
                ))}
              </div>
              {selected && <p className="pf-note">Using {selected.brand} ••••{selected.last4} exp {selected.exp}{selected.originalJobNumber ? ` from job ${selected.originalJobNumber}` : ""}. Enter the Amount, then Charge Now on the left, or leave Auto-charge on (charges after both e-signs).</p>}
              {selected && returnMode !== "none" && <button type="button" className={buttons.className} disabled={saving} onClick={() => void refundNow()} data-testid="charge-saved-card">{buttons.chargeLabel}</button>}
              {selected && returnMode === "none" && (autoOn && !extras?.esign.both
                ? <button type="button" className="btn btn-primary" disabled={saving || !stripeOn} onClick={() => startCharge(selected.id)} data-testid="charge-saved-card">Hold Amount on this card until both e-signs</button>
                : <button type="button" className="btn btn-primary" disabled={saving || !stripeOn} onClick={() => startCharge(selected.id, true)} data-testid="charge-saved-card">Charge selected card</button>)}
              <div className="finder" data-testid="card-finder">
                <h4 className="pay-card-title">Find a saved card by phone, name, or email</h4>
                <div className="link-row">
                  <input value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); void runSearch(); } }} placeholder="Phone, customer name, or email" aria-label="Find existing customer" data-testid="find-customer" />
                  <button type="button" className="btn" onClick={runSearch} data-testid="find-customer-go">Search</button>
                </div>
                {hits && hits.length === 0 && <p className="pf-note">No match.</p>}
                {hits?.map(hit => (
                  <div key={`${hit.kind}-${hit.id}`} className="finder-hit" data-testid="finder-hit">
                    <span>{hit.name || "No name"}{hit.jobNumber ? ` · job ${hit.jobNumber}` : ""}{hit.email ? ` · ${hit.email}` : ""}{hit.phone ? ` · ${hit.phone}` : ""}</span>
                    <span className="finder-cards">
                      {hit.cards.length === 0 && <small className="muted">no saved card</small>}
                      {hit.cards.map(card => (
                        <button type="button" key={card.id} className="btn" onClick={() => linkHit(hit, card.id)} data-testid="finder-use-card">Use {card.brand} ••••{card.last4} {card.exp}</button>
                      ))}
                    </span>
                    <button type="button" className="btn" onClick={() => linkHit(hit)}>Link</button>
                  </div>
                ))}
              </div>
            </div>
          )}
          {showLegacyCard && <div data-testid="pay-card-fields">
            <p className="pf-note">Stripe is not connected. Saving a card here only stores it for the merchant terminal. It does not charge the card.</p>
            <label className="pf-row"><span>Cardholder Name</span><input name="cardholder_name" defaultValue={lead.est.customer_name || ""} data-testid="pay-cardholder" /></label>
            <label className="pf-row"><span>Billing Address</span><input name="billing_address" defaultValue={pickup.street} /></label>
            <div className="pf-row"><span>City/State</span><span className="pf-pair"><input name="billing_city" aria-label="Billing city" value={city} onChange={e => setCity(e.target.value)} /><input name="billing_state" aria-label="Billing state" className="st" value={state} maxLength={2} onChange={e => setState(e.target.value.toUpperCase())} /></span></div>
            <div className="pf-row"><span>ZIP / Country</span><span className="pf-pair">
              <input name="billing_zip" aria-label="Billing ZIP" inputMode="numeric" maxLength={10} defaultValue={pickup.zip} onChange={async e => { const z = e.target.value; if (isUsZip(z)) { const place = await lookupZip(z); if (place) { setCity(place.city); setState(place.state); } } }} />
              <select name="billing_country" aria-label="Country" defaultValue="USA"><option>USA</option><option>Canada</option><option>Mexico</option><option>Other</option></select>
            </span></div>
            <label className="pf-row"><span>Phone</span><PhoneNumberInput name="phone" value={phone} onChange={setPhone} /></label>
            <label className="pf-row"><span>Email</span><input name="email" type="email" defaultValue={lead.est.customer_email || ""} /></label>
            <label className="pf-row"><span>Type</span>
              <span>
                <input type="hidden" name="card_type" value={repPicked ? typeChoice! : ""} />
                <select value={cardType} onChange={e => setTypeChoice(e.target.value)} data-testid="pay-card-type">
                  <option value=""></option>{CARD_TYPE_OPTIONS.map(item => <option key={item} value={item}>{item}</option>)}
                </select>
                {!repPicked && confident && <small className="muted pf-hint" data-testid="pay-card-detected">Detected from number: {confident} (auto)</small>}
                {!repPicked && !confident && detected && <small className="muted pf-hint" data-testid="pay-card-detected">Looks like {detected}, but the length doesn&apos;t match. Left blank.</small>}
              </span>
            </label>
            <label className="pf-row"><span>Card Number</span><input name="card_number" inputMode="numeric" autoComplete="off" maxLength={23} value={cardNumber} onChange={e => setCardNumber(e.target.value)} data-testid="pay-card" /></label>
            <label className="pf-row"><span>Security Code</span><input name="cvv" inputMode="numeric" autoComplete="off" maxLength={4} value={cvv} onChange={e => setCvv(e.target.value)} className="short" data-testid="pay-cvv" /></label>
            <div className="pf-row"><span>Expiration</span><span className="pf-pair">
              <select value={expM} onChange={e => setExpM(e.target.value)} aria-label="Expiration month" data-testid="pay-exp-month"><option value="">MM</option>{MONTHS.map(item => <option key={item}>{item}</option>)}</select>
              <select value={expY} onChange={e => setExpY(e.target.value)} aria-label="Expiration year" data-testid="pay-exp-year"><option value="">YYYY</option>{Array.from({ length: 15 }, (_, i) => thisYear + i).map(year => <option key={year}>{year}</option>)}</select>
              <input type="hidden" name="card_exp" value={expM && expY ? `${expM}/${expY.slice(2)}` : ""} />
            </span></div>
            {warnings.length > 0 && <div className="soft-warn" data-testid="pay-card-warnings">{warnings.map(warning => <div key={warning}>⚠ {warning}</div>)}<small className="muted">Warning only — you can still save.</small></div>}
          </div>}
          {stripeOn
            ? <p className="pf-note">Older typed-in card records still open from Payment Records below (click the TRNO). Only authorized staff can open them, and every view is logged.</p>
            : <p className="pf-note">While Stripe is off, card numbers are encrypted. Only authorized staff can open them, and every view is logged. Older ACH records still open from the list below.</p>}
        </section>
      </form>

      {!stripeOn && <section className="finder">
        <h3 className="pay-card-title">Find existing customer</h3>
        <div className="link-row">
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Phone, name, or email" aria-label="Find existing customer" data-testid="find-customer" />
          <button type="button" className="btn" onClick={runSearch} data-testid="find-customer-go">Search</button>
        </div>
        {hits && hits.length === 0 && <p className="pf-note">No match.</p>}
        {hits?.map(hit => (
          <div key={`${hit.kind}-${hit.id}`} className="finder-hit">
            <span>{hit.name || "No name"}{hit.jobNumber ? ` · job ${hit.jobNumber}` : ""}{hit.email ? ` · ${hit.email}` : ""}{hit.phone ? ` · ${hit.phone}` : ""}</span>
            <span>{hit.cards.map(card => `${card.brand} ••••${card.last4}`).join(", ")}</span>
            <button type="button" className="btn" onClick={() => linkHit(hit)}>Link</button>
          </div>
        ))}
      </section>}

      {openZelle.length > 0 && (
        <section className="pay-card zelle-queue" data-testid="zelle-queue">
          <h3 className="pay-card-title">Zelle to send ASAP (carrier, direct from Fast Break — not Stripe)</h3>
          {openZelle.map(z => (
            <div key={z.id} className="zelle-item" data-testid="zelle-item">
              <span><b>{formatCents(Math.round(Number(z.amount) * 100))}</b> to <b>{z.pay_to}</b>{z.carrier_name ? ` (${z.carrier_name})` : ""} · memo “{z.memo}” · queued {crmStamp(z.created_at)} by {z.created_by_name}</span>
              <span className="link-row">
                <button type="button" className="link-btn" onClick={() => void navigator.clipboard?.writeText(`${z.pay_to}`)}>Copy Zelle</button>
                <button type="button" className="link-btn" onClick={() => void navigator.clipboard?.writeText(Number(z.amount).toFixed(2))}>Copy amount</button>
                <input value={zelleConf[z.id] || ""} onChange={e => setZelleConf(m => ({ ...m, [z.id]: e.target.value }))} placeholder="Zelle confirmation #" aria-label="Zelle confirmation number" data-testid="zelle-conf" />
                <button type="button" className="btn btn-primary" onClick={() => void zelleSent(z.id)} data-testid="zelle-sent">Mark Zelle sent</button>
                <button type="button" className="link-btn danger" onClick={() => void zelleCancel(z.id)}>Cancel</button>
              </span>
            </div>
          ))}
        </section>
      )}
      {!payoutsReady && <p className="pf-note" data-testid="carrier-not-ready">Return to carrier needs the carrier_payouts database update (migration 20261031170000).</p>}

      <section className="pay-records">
        <div className="pay-records-title">Payment Records</div>
        <div className="table-scroll">
          <table className="mini-table" data-testid="payment-records"><thead><tr><th>TRNO</th><th>Date</th><th>Type</th><th>Amount</th><th>Deposit?</th><th>Confirm#</th><th>Remarks</th><th>Processed By</th><th>Edit By</th><th></th></tr></thead><tbody>
            {pending.lines.filter(l => l.source === "card").map((l, i) => (
              <tr key={`pending-${i}`} className="row-pending" data-testid="pending-row">
                <td>—</td><td className="nowrap">—</td><td>CC · pending</td><td className="num">{formatCents(l.amountC)}</td><td>{l.isDeposit ? "Yes" : ""}</td><td></td><td>{l.label}</td><td></td><td></td><td></td>
              </tr>
            ))}
            {lead.payments.length === 0 && payouts.length === 0 && pending.lines.length === 0 && <tr><td colSpan={10} className="muted" data-testid="no-payments">No payments yet.</td></tr>}
            {lead.payments.map(payment => {
              const unpaid = !countsAsPaid(payment.charge_status);
              return (
                <tr key={payment.id} className={`${isCustomerRefund(payment) ? "row-return" : ""}${payment.voided_at ? " voided" : ""}`.trim() || undefined} data-testid="payment-row">
                  <td><button type="button" className="link-btn trno" onClick={() => open(payment.id)} data-testid="payment-trno">{numberOf(payment.id)}</button></td>
                  <td className="nowrap">{crmDate(payment.payment_date) || crmStamp(payment.created_at)}</td>
                  <td>{isCustomerRefund(payment) ? "Refund to cust · " : ""}{payment.method === "Credit Card" ? "CC" : payment.method}{payment.card_last4 ? ` ••••${payment.card_last4}` : ""}{unpaid ? " (not paid)" : ""}{multiVehicle && typeof (payment as { vehicle_index?: number | null }).vehicle_index === "number" ? ` · Veh ${((payment as { vehicle_index?: number | null }).vehicle_index ?? 0) + 1}` : ""}</td>
                  <td className="num">{formatCents(toCents(payment.amount) ?? 0)}</td>
                  <td>{payment.is_deposit ? "Yes" : ""}</td>
                  <td>{payment.confirmation_no}</td>
                  <td>{payment.remark}{payment.voided_at ? " (voided)" : ""}</td>
                  <td>{(payment.created_by_name || "").toUpperCase()}</td>
                  <td>{(payment.voided_at ? nameOf(payment.voided_by) : payment.created_by_name || "").toUpperCase()}</td>
                  <td>{lead.staff.role === "admin" && !payment.voided_at && <button type="button" className="link-btn danger" onClick={async () => { if (window.confirm("Void this payment in the CRM books? This does not refund the customer. Check Return to customer and click Refund Now for that.")) { const result = await voidPayment(payment.id); if (result.ok) onChanged(); else setMsg({ text: result.error, error: true }); } }}>Void</button>}</td>
                </tr>
              );
            })}
            {payouts.map(z => (
              <tr key={z.id} className={`row-carrier${z.status === "failed" || z.status === "cancelled" ? " voided" : ""}`} data-testid="carrier-row">
                <td>—</td>
                <td className="nowrap">{crmStamp(z.created_at)}</td>
                <td>{z.source === "cod" ? "Carrier · added to COD" : `Return to carrier · ${z.method}`}</td>
                <td className="num">{z.source === "cod" ? "+" : "−"}{formatCents(Math.round(Number(z.amount) * 100))}</td>
                <td>{z.source === "cod" ? "" : "From deposit"}</td>
                <td>{z.confirmation_no}</td>
                <td>{carrierStatusLabel(z.status, z.method || "")}{z.carrier_name ? ` · ${z.carrier_name}` : ""}{z.pay_to ? ` · ${z.pay_to}` : ""}{z.remark ? ` — ${z.remark}` : ""}</td>
                <td>{(z.created_by_name || "").toUpperCase()}</td>
                <td>{(z.sent_by_name || "").toUpperCase()}</td>
                <td>{z.status === "added_to_cod" && canRefund && <button type="button" className="link-btn danger" onClick={() => void zelleCancel(z.id)}>Cancel</button>}</td>
              </tr>
            ))}
          </tbody></table>
        </div>
      </section>

      {details && (
        <div className="modal-backdrop" onClick={() => setDetails(null)}>
          <div className="modal" onClick={e => e.stopPropagation()} role="dialog" aria-label="Payment details" data-testid="payment-modal">
            <h3 className="section-title">Payment {details.trno} — {crmStamp(details.created_at)}</h3>
            <dl>
              <dt>Payment date</dt><dd>{crmDate(details.payment_date)}</dd>
              <dt>Method</dt><dd>{details.method}</dd>
              <dt>Amount</dt><dd>{formatCents(toCents(details.amount) ?? 0)} {details.is_deposit ? "(Deposit)" : ""}</dd>
              <dt>Confirmation No.</dt><dd>{details.confirmation_no}</dd>
              <dt>Remark</dt><dd>{details.remark}</dd>
              {details.method === "ACH" ? <>
                <dt>Account name</dt><dd>{details.cardholder_name}</dd>
                <dt>Bank</dt><dd>{details.ach?.bank || (details.masked ? "(hidden)" : "—")}</dd>
                <dt>Routing No.</dt><dd className="card-number">{details.ach?.routing || "•••••••••"}</dd>
                <dt>Account No.</dt><dd className="card-number" data-testid="full-account">{details.ach?.account || (details.card_last4 ? `••••${details.card_last4}` : "—")}</dd>
              </> : <>
                <dt>Cardholder</dt><dd>{details.cardholder_name}</dd>
                <dt>Card type</dt><dd>{details.card_type}</dd>
                <dt>Card number</dt><dd className="card-number" data-testid="full-card">{details.card_number ? details.card_number.replace(/(\d{4})(?=\d)/g, "$1 ") : details.card_last4 ? `•••• •••• •••• ${details.card_last4}` : "—"}</dd>
                <dt>Exp</dt><dd>{details.card_exp}</dd>
                <dt>Security code</dt><dd className="card-number">{details.cvv || (details.masked && details.card_last4 ? "•••" : "—")}</dd>
                <dt>Billing address</dt><dd>{[details.billing_address, [details.billing_city, details.billing_state].filter(Boolean).join(", "), details.billing_zip, details.country].filter(Boolean).join(", ")}</dd>
                <dt>Email / phone</dt><dd>{[details.email, details.phone ? phoneForField(details.phone) || details.phone : ""].filter(Boolean).join(" · ")}</dd>
              </>}
              <dt>Deposit paid (all)</dt><dd>{details.deposit !== null ? formatCents(Math.round(details.deposit * 100)) : ""}</dd>
              <dt>Job total</dt><dd>{details.total !== null ? formatCents(Math.round(details.total * 100)) : ""}</dd>
              <dt>Processed by</dt><dd>{details.created_by_name}</dd>
            </dl>
            <p className="muted" style={{ fontSize: 11 }} data-testid="payment-modal-note">{details.masked ? "Full numbers are shown to admins / authorized staff only. This request was logged." : "This view was logged (who, when, IP)."}</p>
            <button type="button" className="btn btn-primary" onClick={() => setDetails(null)}>Close</button>
          </div>
        </div>
      )}
    </div>
  );
}
