-- Customer email views. Additive only.
-- A new table holds quote-button clicks and tracking-pixel hits.
-- crm_emails.kind gains the new letter names (the check is replaced; existing rows stay valid).
-- No other table is changed. Do not apply this by hand from the app; it runs with the other migrations.

alter table public.crm_emails drop constraint if exists crm_emails_kind_check;
alter table public.crm_emails add constraint crm_emails_kind_check
  check (kind in (
    'cc_form', 'e_quote', 'booked_esign', 'free_text',
    'request_received', 'company_intro', 'ready_to_book', 'flex_pricing',
    'honest_followup', 'booked_scheduled', 'pickup_confirmed', 'hi_lets_chat'
  ));

create table if not exists public.customer_email_view_events (
  id uuid primary key default gen_random_uuid(),
  email_id uuid not null references public.crm_emails(id) on delete restrict,
  token text not null,
  estimate_id uuid not null references public.estimates(id) on delete restrict,
  event_type text not null check (event_type in ('quote_viewed', 'email_viewed')),
  created_at timestamptz not null default now(),
  user_agent text
);

create index if not exists customer_email_view_events_estimate_idx
  on public.customer_email_view_events (estimate_id, created_at desc);
create index if not exists customer_email_view_events_email_idx
  on public.customer_email_view_events (email_id, created_at);

drop trigger if exists customer_email_view_events_append_only on public.customer_email_view_events;
create trigger customer_email_view_events_append_only
  before update or delete on public.customer_email_view_events
  for each row execute function public.crm_reject_history_change();
drop trigger if exists customer_email_view_events_no_truncate on public.customer_email_view_events;
create trigger customer_email_view_events_no_truncate
  before truncate on public.customer_email_view_events
  for each statement execute function public.crm_reject_history_change();

alter table public.customer_email_view_events enable row level security;
revoke all on table public.customer_email_view_events from public, anon, authenticated;
revoke update, delete, truncate on table public.customer_email_view_events from service_role;
grant select, insert on table public.customer_email_view_events to service_role;
