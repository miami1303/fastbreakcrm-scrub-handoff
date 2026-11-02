# Return to customer / Return to carrier (Oct 31, 2026)

Payments tab → next to **Payment Deposit** are two checkboxes: **Return to customer** and **Return to carrier**
(admin / supervisor only, one at a time). When either is checked, **Charge Now**, **Update Payment** and the
saved-card Charge/Hold button turn **red** and become **Refund Now**; auto-charge is paused and the card box
is hidden, so nothing can be charged by mistake. The **Amount** field is the refund amount and **Payment
Remark** is the reason.

## Return to customer → Stripe refund
Refund Now refunds part or all of one Stripe-confirmed charge on this job (card, or Cash App Pay paid through
the Stripe link) with `stripe.refunds.create`. A negative line is written to Payment Records ("Refund to cust",
red) and it comes off Customer Payments. The summary strip still shows "Refunded to cust".

## Return to carrier — toggle: From deposit | Add to COD
| Mode | What happens | Money moves? |
|---|---|---|
| **From deposit · Zelle** | Queued **ASAP** in "Zelle to send" (carrier Zelle, amount, memo). Office sends it in the Fast Break bank app and clicks **Mark Zelle sent** with the Zelle confirmation #. Optional email alert if `PAYOUT_ALERT_EMAIL` is set. | Yes, by the office in the bank app. **Stripe never touches Zelle.** |
| **From deposit · Cash App** | Through Stripe: Stripe Connect transfer (`stripe.transfers.create`) to the carrier's Stripe payout account `acct_…`, which pays out to their bank or Cash App Card. **Invite carrier to Stripe** creates an Express account + secure onboarding link. | Yes, through Stripe immediately. |
| **Add to COD** | Recorded as "Carrier · added to COD": the carrier collects it with the COD, so the car gets picked up without taking from the deposit. | No. Update Carrier COD on Charges if the customer documents should show it. |

Carrier returns never change Customer Payments or the customer balance. The strip shows Deposit paid,
Returned to carrier from deposit, Deposit kept, Added to carrier COD and COD to carrier. Every line (queued,
sent, failed, cancelled, added to COD) stays in Payment Records (orange).

## Why Zelle is not automatic
Zelle has no public API for a normal business bank account, and we do not fake one. Options to make it
fully automatic later:
- **Bank of America CashPro Payment API** supports Zelle disbursements for CashPro clients
  (enroll in CashPro, then send the API Access Form to GlobalAPIOps@bofa.com, "Global Digital
  Disbursements (Paypal, Zelle)"). Once approved, `refundCarrier` can call it instead of queueing.
- BoA **Recipient Select** (carrier picks Zelle/ACH/RTP in a portal) is another CashPro option.
Until then, the queue + Mark Zelle sent is the record in the CRM.

Fast Break's own Zelle (customers paying in): set `PAY_ZELLE` (blank = no Zelle instructions).

## Setup before go-live
1. Apply migration `supabase/migrations/20261031170000_carrier_payouts.sql`.
2. Cash App carriers: turn on **Stripe Connect** (Express) in the Stripe Dashboard.
3. Optional: `PAYOUT_ALERT_EMAIL` = inbox that gets "ZELLE TO SEND ASAP" alerts.
