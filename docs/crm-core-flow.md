# CRM core flow notes

Setup: copy `.env.example`, set Supabase keys and `CARD_ENCRYPTION_KEY` (generate with `openssl rand -base64 32`; never commit it), apply `supabase/migrations` in order. Local e2e: `tests/e2e/` (ephemeral Postgres + PostgREST + fake auth/realtime).


## Google Maps button and mileage

- Lead page, under the customer's email: **Google Maps — pickup to delivery** opens
  `https://www.google.com/maps/dir/?api=1&origin=…&destination=…&travelmode=driving` in a new tab (free, no key).
- Places are never a bare ZIP (Google can resolve a bare ZIP to the wrong region). `lib/maps.ts` sends
  `Street, City, ST ZIP, USA` when a street exists, else `City, ST ZIP, USA` from the ZIP lookup, else the
  ZIP lookup's `lat,lon`.
- CRM mileage (`lib/mileage-server.ts`) routes between the same ZIP lookup's coordinates for that exact ZIP
  (cached in `zip_geo`) using the public OSRM server; if OSRM fails, straight-line x 1.2 (marked "est.").
  Reps can override; "Recalculate" re-runs it.
- Test case: Dublin GA 31021 -> Carbon Hill AL 35549. Google: 346 mi fastest (I-20 W), alternates 338 / 349.
  OSRM: 337 mi. Fallback: 341 mi (est.).

## Email Center, Free Text Email, Extra Stop / Notes

- Lead page: "N emails sent" next to the customer's email (count of the append-only `crm_emails`).
  Hover the email for the Email Center: Credit Card Authorization Form (e-sign), Auto Transport
  Order for Service (E-Quote or E-Sign), Free Text Email, and Previous Emails.
- Previous Emails: `#` (per-lead `seq`, set by a DB trigger), sent time + rep, To (+cc), Subject,
  Text (exact `html_snapshot` stored at send time, shown read-only in a sandboxed frame with the
  tracking pixel removed), E-sign details, Viewed (email opened / quote viewed).
  `crm_emails` stays append-only (UPDATE/DELETE/TRUNCATE rejected by trigger).
- Free Text Email: subject + rich body (sanitized server-side by `lib/templates/sanitize.ts`), sent
  in the shared layout with logo header, rep signature, opt-out link and open pixel; respects the
  removal list; counts as touching the lead. Composer order: header table, Subject, editor,
  "Include link to view your quote" (real tracked link to /d/<job>/<token>, fires Quote Viewed),
  Send Email / Preview / Exit. Preview opens a separate modal with exactly what the customer sees.
- Rep signature (every shared-layout template): rep full name, email, phone from Maintenance;
  blank phone -> company main number; blank email -> company email. One line on the one-page docs.
- Extra Stop / Notes: button on the lead (shows "(has notes)"), rich editor in a modal; saved
  by Submit Charges; each change logged (`estimate_extra_notes_history`, shown in Charges change
  history). Renders as a boxed section between From/To and Vehicles on the E-Quote and booked
  order; hidden when empty. Links: http/https/mailto only, new tab, rel=noopener, name shown.
- Sending is still "prepare + log": the CRM copies the formatted email and opens the rep's mail app
  (no SMTP provider is configured yet).

## Customer links (job number + token)

Every customer-facing link (E-Quote, booked e-sign contract, CC Auth form, Free Text
"View your quote") is `https://<site>/d/<JOB NUMBER>/<token>`, e.g. `/d/FB400001/9f3c…`.
The token is still the unguessable secret; the job number makes the link readable and
is checked server-side: if it does not match the token's job the page shows
"This link is not valid" and no view is recorded. Old `/d/<token>` links keep working.
The page title and header show the job number.

**Job numbers.** `'FB' || nextval('public.job_number_seq')` (trigger from
`20261023050000_job_numbers.sql`). The first job is **FB400001** (then FB400002, ...), set by
`20261023170000_job_number_start_400001.sql`, whose `job_number_start` constant is the one value
to change if the start ever moves (add a new migration; don't edit old ones). It never moves the
sequence backwards past an existing job. The sequence is bigint and the column is text, so
numbering continues past 999999 as FB1000000. Search accepts `FB400001`, `400001` or `fb400001`;
the Delete Lead confirmation accepts `FB400001` or `400001`.

## E-sign bar, icons and counts

- Booked "Auto Transport Order for Service" and the CC Authorization form each open with a
  sign bar at the very top (above the logo): `[ ] I have read and agree to the terms | Name | Email | Sign`.
  Sign stays disabled until all are filled. A red "E-sign" link sits at the top and the bottom
  of each document and jumps to the bar. Signing happens in place (no redirect / landing page);
  the rep's open lead updates through Realtime.
- On the lead, under the customer email next to "N emails sent": a green **$** box
  (contract signed) and a blue **CC** box (CC form signed), each shown only once signed.
- Count math (from the append-only `crm_emails` history): e-sign emails are the sends of kind
  `booked_esign` (contract) and `cc_form`. **Received** = those with `signed_at`; **Pending** = the rest.
  Each send is counted once, in exactly one bucket (Pending + Received = e-sign sends).
  Clicking either count opens the Email Center history filtered to e-sign rows ("Show all" clears it).


## Follow Up rule

`lib/follow-up-rule.ts` (unit-tested in `tests/follow-up-rule.test.mjs`): a lead enters
Follow Up (N) when its follow-up date+time is reached; the picker on the lead takes the time as
Central Time (America/Chicago, DST-aware). It stays indefinitely; it leaves ONLY when the lead is
touched AFTER the due time — an email sent (any template) or a note added (any of the 4 note
boxes). A touch before the due time does not pre-clear it. Setting a new future time clears it
until that time is reached. Counts update live (Realtime on estimates: managers all, reps
their own) and the browser switches a lead on at its exact time.

## Shipment Remarks

One plain-text "Remarks" box under Vehicles on the lead (`estimates.shipment_remarks`), saved by
Submit Charges and logged in Charges change history (`estimate_extra_notes_history.field = 'remarks'`).
Printed as "Remarks" directly under Vehicles on the E-Quote and the booked / e-sign Auto Transport
Order; hidden when empty; not on the CC form. Per-vehicle remarks are unchanged.

## Email sending (go live)

Off until configured; otherwise the CRM keeps copy + mailto. `lib/mailer.ts`:

- SMTP: `SMTP_HOST`, `SMTP_PORT` (default 587; 465 = TLS), `SMTP_SECURE` (optional), `SMTP_USER`, `SMTP_PASS`.
- or Resend: `RESEND_API_KEY` (domain verified in Resend: its SPF/DKIM DNS records on fastbreakcrm.test).
- `EMAIL_TRANSPORT` (optional, `smtp`|`resend`) when both are set.
- Sender: `EMAIL_FROM_ADDRESS` / `EMAIL_FROM_NAME` (optional), else Company Settings
  (Company email / Email "From" name) = `support@fastbreakcrm.test` / "Fastbreak CRM".
- Reply-To = the lead rep's email from Maintenance (both reps use info@ today, so replies land in the
  shared inbox). Company Settings "Send emails as" = rep makes emails go out From the rep's own
  address when its domain is allowed (`EMAIL_SEND_AS_DOMAINS`, default: the company address's domain).
- The rep is CC'd on template emails; Free Text CC follows its checkbox. Each send is logged with
  `delivery` (mailto/smtp/resend) and a `delivered` / `delivery_failed` event.

Other env (existing): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SITE_URL`, `CARD_ENCRYPTION_KEY`.
Stripe, when the partner is ready: `STRIPE_SECRET_KEY`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`,
`STRIPE_WEBHOOK_SECRET` (test keys first). Blank keys charge nothing.

## Lead pages (tabs)

Every lead has the tab bar **Entry Form | Charges | Payments | Printed Estimate | Emails | Exit**
(`/estimates/<id>/entry`, `/estimates/<id>` = Charges (default), `/payments`, `/estimate`,
`/emails`; Add/Update Vehicle is `/estimates/<id>/vehicles`). One client layout
(`app/estimates/[id]/layout.tsx`) keeps the form state across tabs and shows the same Job panel
on every tab (Job No, then "Follow-Up" + priority with **Book This Job**, or green
"Booked - Operations" + booked date). `/leads/<id>/...` redirects here.

- **Entry Form**: ONE pickup date (popup picker) + pickup time (after the new migration) and a
  required **Lead Source**. The backup pickup date (the window) is only on the Charges right panel.
  New estimate flow: Entry Form -> Save -> Add Vehicle -> Charges.
- **Printed Estimate**: read-only preview of what the customer would see now (E-Quote until
  booked, booked order after) + CC form. It has no tracking pixel/token, so it never counts as a
  Quote View.
- All date pickers use the shared `lib/calendar.ts` math (leap years incl. 2000/2100, Sun-Sat,
  America/Chicago "today", unlimited paging) via `app/components/DatePopup.tsx`.

## Pricing

Three boxes: **Deposit**, **Carrier COD** (carrier pay), **Total**. Total = Deposit + COD + the
filled extra charge lines (max 3, positive amounts). Changing Deposit or COD keeps the other and
recalculates Total; typing the Total recalculates COD = Total - Deposit - extras (never below 0,
with a warning). Vehicle prices are carrier pay: COD defaults to the sum of price x qty until the
rep types a different COD. Vehicle prices never print on customer documents. Integer-cents math:
`lib/pricing.ts`.

Customer documents: the E-Quote shows the Total only. The booked order / CC form show Customer
Payment (all recorded, non-void payments) and Balance Due **only once a payment exists**; before
that they show the Total only (no "$0.00"), in the CRM preview and on the customer page alike.
Filled extra charge lines print above the Total; empty ones never print.

- Charges panel numbers come from the boxes on screen (`chargesSummary` in `lib/pricing.ts`):
  the "Total is less than Deposit + extra charges" warning shows only while a Total the rep
  TYPED is below Deposit + extras (re-checked live; cleared when Deposit / COD / extras change
  or after Submit Charges). "Payments · Balance" = recorded payments and live Total - payments.
- Customer documents (booked order, CC form) use the saved Total and Balance = saved Total -
  recorded payments; the E-Quote shows the Total only.

## Booked rule

Booked, cancelled and deleted jobs are never follow-ups: they are excluded from every follow-up
list and count (Follow-Up Menu, Follow Up banner, menu "Follow-Up (N)", New Lead / Assign
banners). Booking puts the job on the Operations Calendar under its pickup date (and under the
backup date marked "2nd Pick-Up"). Release Book returns it to follow-up with its follow-up date.

## Menu pages

- Main menu hub (`/user-menu`, everyone lands here after login; `/admin-menu` redirects here).
- Follow-Up Menu (`/follow-up`): priority circles 0-8, the 8 lists in Owner's order, Sort By.
- **Recurring Customers** (`/recurring`): a lead is "recurring" when the customer opened their
  quote link **again after the first view** (a `viewed` event after the first one). One row per
  lead (its latest re-open in the range), newest first.
- Operations Calendar (`/operations`), Estimates in Process / Advanced Search (`/estimates`),
  Salesmen Performance / Reports (`/performance`, incl. count by Lead Source), Recent Accessed
  Jobs (`/recent`, last 20 leads opened in this browser).
- Every CRM page redirects to `/user-login` when logged out (`middleware.ts`).

## Lead Source

Required on the Entry Form (dropdown with type-to-filter). Options live in `crm_settings` key
`lead_sources` (`[{label, hidden?}]`; defaults in `lib/lead-sources.ts`); admins add, rename or
hide them in Maintenance > Lead Sources. Stored on the lead in the existing
`estimates.lead_source` column (no migration). Website intake leads must be saved with
`WEB_LEAD_SOURCE` ("Web Lead"). Rep-side only: shown on the Charges right panel, Estimates in
Process (column + filter) and Salesmen Performance; never on customer documents.

## Logins

Usernames are matched **exactly and case-sensitively** against `user_identities.username`
(`Mark` works, `mark` does not); only surrounding spaces are trimmed.

## Payments

The Payments tab lists Credit Card, Zelle, Cash App, and PayPal. Older ACH, Cash, Check, and
Other rows still open. Update Payment only writes the ledger. A negative amount corrects the
books and does not charge, refund, or store a new card number. There is no refund button.
Void removes a row from the CRM books and does not refund; refunds stay in Stripe.

Stripe charges only when `STRIPE_SECRET_KEY` and `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` are both
set and are both test or both live. Until then the screen says Stripe is not connected, and the
old encrypted card form stays so a card can be run on the merchant terminal. That save is not a
charge. `PAYMENTS_PROVIDER` is not used. Card numbers are not typed into the CRM once Stripe is
connected; Stripe's card box is used instead. Saved Stripe cards (brand, last 4, expiration,
original job number) belong to the customer and show as blue bars when one customer matches the
lead by name or phone or email. Several matches are not linked on their own.

Auto-charge is off until someone turns it on for that booking, including an online booking. It
charges only after both e-signs on the existing e-sign page: a signed contract
(`crm_emails.kind = booked_esign` with a `signed` event) and a signed credit card form
(`kind = cc_form` with a `signed` event). The customer page is not a new e-sign flow.

Send Customer Payment Link opens a Stripe-hosted page and shows the link to copy. The CRM emails
it only when email is already configured and the address is not opted out. Coming back from that
page does not mark the job paid. Paid comes from a checked Stripe notification
(`STRIPE_WEBHOOK_SECRET`, endpoint `/api/stripe/webhook`).

`supabase/migrations/payments_20261026143000_stripe_cards_and_customer_methods.sql` adds the
customer, saved-card, and payment-link tables. It is not applied to the live database. Until it
is, the new buttons say so and the existing ledger save still works.

## New migration (not applied live)

`20261023200000_lead_tabs_priority_extras.sql` (idempotent): priority check 0-8 (+ labels 5-8),
`estimates.pickup_time`, `quotes.extra_charges`, vehicle `color/engine/qty/price`, and the
history field check for vehicle / extra-charge change logs. The app hides these fields until it
is applied.
