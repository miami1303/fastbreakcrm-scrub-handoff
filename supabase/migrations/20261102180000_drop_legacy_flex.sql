-- Fast Break CRM: retire the legacy FLEX pricing feature (inherited from the scrubbed baseline).
-- Fresh Fast Break databases never create these objects (the original migrations were removed);
-- this forward migration only cleans up databases that already applied them. Idempotent.
alter table public.estimates drop column if exists flex;
alter table public.vehicles drop column if exists flex;

delete from public.email_templates where key = 'flex_pricing';

-- Keep send history: re-label old sends of the retired letter as a generic custom letter.
alter table public.crm_emails drop constraint if exists crm_emails_kind_check;
update public.crm_emails set kind = 'custom_letter' where kind = 'flex_pricing';
alter table public.crm_emails add constraint crm_emails_kind_check
  check (kind in (
    'cc_form', 'e_quote', 'booked_esign', 'free_text',
    'request_received', 'company_intro', 'ready_to_book',
    'honest_followup', 'booked_scheduled', 'pickup_confirmed', 'hi_lets_chat',
    'payment_link', 'carrier_confirm', 'custom_letter', 'custom_quote'
  ));
