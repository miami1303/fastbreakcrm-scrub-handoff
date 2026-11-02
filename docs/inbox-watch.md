# Inbox watch (in-CRM Gmail): FB payments + Central Dispatch pickup/delivered

Runs inside the CRM (Next.js route), not as a Grok Bot routine, and does not use the bot's Gmail connector.

## What it does
| Email | Result |
|---|---|
| Ops's crystal company (crystal words, label `Crystal`/`Ops`, or `INBOX_IGNORE_WORDS`) | **Ignored**, always, before anything else |
| Not to/from Fast Break | Ignored |
| FB payment, carrier (says carrier / MC# / DOT# / trucking) + job # | Carrier Owes marked paid + added to deposit bookkeeping (`carrier_owes_deposited_at`), Carrier-owes banner stopped, **Payment received** banner. Customer deposit/COD/total/balance unchanged |
| FB payment, customer | Payment Record added (deduped on Stripe `pi_` / confirmation # / Gmail id; Stripe webhook payments are not doubled), **Payment received** banner. Matched by job #, else customer email, else a unique customer name. Failed/pending notices record nothing |
| Central Dispatch "picked up" | **Customer pickup** banner with job number |
| Central Dispatch "delivered" | Stamps Delivered (if not yet), **Customer delivered** banner, and raises **Carrier owes us money** when the carrier still owes (same rule as the Delivered? button) |

Unmatched payments still raise a "Payment received … not matched" banner. Every email is processed once (`inbox_watch_messages`).

**Job numbers:** CD mail only matches when it carries the FB job number (e.g. `FB400123`), so post loads on Central Dispatch with the FB job number as the Order ID.

## Enable
1. Apply migration `20261101000000_inbox_watch_and_carrier_deposit.sql`.
2. Google Cloud: OAuth client (Web), Gmail API enabled, scope `gmail.readonly`; get a refresh token for the company Gmail inbox.
3. Env vars: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`, optional `GMAIL_USER`, `CRON_SECRET`, optional `INBOX_IGNORE_WORDS` (comma list), optional `INBOUND_EMAIL_SECRET`.
4. Schedule `GET /api/cron/inbox-watch` with `Authorization: Bearer $CRON_SECRET` every 5–10 min (Vercel Pro cron in `vercel.json`, Supabase pg_cron + pg_net, or any external scheduler). Not added to `vercel.json` here because sub-daily crons fail deploys on Vercel Hobby.
5. Admin > Settings > **Inbox watch ON** (default OFF).

Optional push path: `POST /api/inbound-email` with `{ id, from, to, subject, text, labels? }` and `Authorization: Bearer $INBOUND_EMAIL_SECRET` (e.g. from a Cloudflare Email Routing worker or Gmail forward).

## TODO
Parsers in `lib/inbox-watch/classify.ts` are tuned to typical Stripe / Zelle / Central Dispatch wording. Add real redacted samples to `tests/inbox-watch.test.mjs` and adjust. Note: a customer literally named "Crystal" would be ignored by the crystal filter; prefer a Gmail label on Ops's mail and trim `CRYSTAL_WORDS` if that happens.

## Needs carrier (2 days after pickup window) + banner dismiss rules

- **Needs carrier** banner: a BOOKED job with no carrier assigned (`carrier_assigned_at` null) on/after
  the pickup window end + 2 days (Chicago date). Window end = Pickup second date (`backup_date`), or the
  first date (`primary_date`) when there is no second. Raised once per window (`estimates.needs_carrier_window`).
  It does NOT clear on view. It clears when a carrier is assigned (Carrier Info note on a booked job) or the
  pickup dates are changed (re-raised only if the new window is also 2+ days past).
- **Needs carrier email**: when the cron raises the banner it also emails OPS_ALERT_EMAIL from
  info@ (subject `ATTN needs carrier: Job #… — Customer`, body: job#, customer, pickup window end, lead link).
  Once per window: sent only after claiming `estimates.needs_carrier_window`.
- Scan route: `GET /api/cron/needs-carrier` with `Authorization: Bearer $CRON_SECRET`. Once or twice a
  day is plenty (a daily Vercel Hobby cron is fine, or any external scheduler). Not added to vercel.json.
- **Payment received / Customer pickup / Customer delivered / Carrier owes** clear for EACH admin when that
  admin views them (opens the banner panel, or opens that lead). Carrier owes still also clears for everyone
  when the carrier's payment is entered.
- **Carrier owes email**: subject `ATTN Ops carrier owes: $X — Job #… — Customer`, to
  OPS_ALERT_EMAIL, with lead + carrier info. Sent once per delivery (gated by
  `carrier_owes_notified_at`) from both the Delivered? button and the Central Dispatch delivered email.
  It is outbound from the CRM, so the crystal-company inbox-watch filter never touches it.
