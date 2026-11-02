-- Real email sending (SMTP or Resend), OFF until configured. Append-only history keeps
-- how each email went out and the provider result.
alter table public.crm_emails add column if not exists delivery text not null default 'mailto'
  check (delivery in ('mailto', 'smtp', 'resend'));
alter table public.crm_emails add column if not exists reply_to text;

alter table public.crm_email_events drop constraint if exists crm_email_events_event_check;
alter table public.crm_email_events add constraint crm_email_events_event_check
  check (event in ('opened', 'viewed', 'signed', 'unsubscribed', 'block_removed', 'delivered', 'delivery_failed'));
alter table public.crm_email_events add column if not exists detail text;
