-- Carrier Info notes + Carrier Confirmation email (Owner 2026-10-31).
-- Additive only: existing rows stay valid; no data is changed. Not applied to prod in this PR.

-- 1) estimate_notes gains kind 'carrier' (append-only like the others: the existing
--    estimate_notes_append_only trigger still rejects update/delete). Cancels + reassigns = new rows;
--    the newest carrier note is the current carrier (customer email shows only that one).
alter table public.estimate_notes drop constraint if exists estimate_notes_kind_check;
alter table public.estimate_notes add constraint estimate_notes_kind_check
  check (kind in ('rep', 'policy', 'customer', 'operations', 'carrier'));

-- 2) crm_emails gains kind 'carrier_confirm' (tracked job-number link + pixel, no e-sign).
alter table public.crm_emails drop constraint if exists crm_emails_kind_check;
alter table public.crm_emails add constraint crm_emails_kind_check
  check (kind in (
    'cc_form', 'e_quote', 'booked_esign', 'free_text',
    'request_received', 'company_intro', 'ready_to_book', 'flex_pricing',
    'honest_followup', 'booked_scheduled', 'pickup_confirmed', 'hi_lets_chat',
    'payment_link', 'carrier_confirm'
  ));
