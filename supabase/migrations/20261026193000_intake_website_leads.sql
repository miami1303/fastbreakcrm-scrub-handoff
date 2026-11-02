-- Website quote requests.
-- Adds a place to record when the office email did not send, and a small counter
-- so one visitor cannot submit the form over and over. Nothing is deleted or renamed.
-- Do not run this on the live database until Owner says to.

alter table public.estimates
  add column if not exists intake_notice_error text,
  add column if not exists intake_notice_sent_at timestamptz;

comment on column public.estimates.intake_notice_error is
  'Set when a website quote was saved but the office email notice did not send.';

create table if not exists public.intake_rate_events (
  id uuid primary key default gen_random_uuid(),
  source_key text not null,
  created_at timestamptz not null default now()
);

create index if not exists intake_rate_events_source_created_idx
  on public.intake_rate_events (source_key, created_at desc);

alter table public.intake_rate_events enable row level security;
revoke all on public.intake_rate_events from anon, authenticated;
