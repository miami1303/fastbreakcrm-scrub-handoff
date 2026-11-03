-- Payment Link emails (sent from the Payments tab) are logged in crm_emails so they show in the
-- Email Center's Previous Emails with open/click tracking, like every other CRM email.
-- Additive only: the kind check gains 'payment_link'; existing rows stay valid. No data is changed.
alter table public.crm_emails drop constraint if exists crm_emails_kind_check;
alter table public.crm_emails add constraint crm_emails_kind_check
  check (kind in (
    'cc_form', 'e_quote', 'booked_esign', 'free_text',
    'request_received', 'company_intro', 'ready_to_book',
    'honest_followup', 'booked_scheduled', 'pickup_confirmed', 'hi_lets_chat',
    'payment_link'
  ));
