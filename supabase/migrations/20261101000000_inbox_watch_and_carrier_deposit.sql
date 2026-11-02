-- In-CRM inbox watch (FB payments + Central Dispatch pickup/delivered) + carrier-paid deposit bookkeeping.
-- Owner 2026-10-31. Additive, idempotent. Does not change customer deposit / COD / total / balance.
--
-- estimates.carrier_owes_deposited_at  carrier's payment was added to deposit bookkeeping (back office only).
-- inbox_watch_messages                 one row per email the CRM looked at (dedupe + audit). Service role only.
-- crm_settings.inbox_watch_enabled     admin toggle (default OFF).
alter table public.estimates add column if not exists carrier_owes_deposited_at timestamptz;

create table if not exists public.inbox_watch_messages (
  message_id text primary key,
  created_at timestamptz not null default now(),
  kind text not null,
  status text not null default 'new',
  subject text,
  job_number text,
  amount numeric(12,2),
  estimate_id uuid references public.estimates(id) on delete set null,
  note text
);
create index if not exists inbox_watch_messages_created_idx on public.inbox_watch_messages (created_at desc);
alter table public.inbox_watch_messages enable row level security;
revoke all on public.inbox_watch_messages from anon, authenticated;

insert into public.crm_settings (key, value) values ('inbox_watch_enabled', 'false'::jsonb) on conflict (key) do nothing;

-- Needs carrier (Owner 2026-10-31): pickup window key ("primary|backup") the 2-day "Needs carrier"
-- banner was raised for. Null = not raised. A different key = dates changed -> old banner cleared.
alter table public.estimates add column if not exists needs_carrier_window text;
