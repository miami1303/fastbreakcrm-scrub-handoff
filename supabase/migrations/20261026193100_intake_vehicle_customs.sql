-- Makes, models, and vehicle types the office typed because they were not in the list.
-- They show up in the dropdowns next time. Nothing is deleted or renamed.
-- Do not run this on the live database until Owner says to.

create table if not exists public.intake_vehicle_customs (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('make', 'model', 'type')),
  make_label text not null default '',
  value_label text not null,
  make_key text not null default '',
  value_key text not null,
  year integer,
  created_at timestamptz not null default now(),
  constraint intake_vehicle_customs_value_len check (char_length(value_label) between 1 and 60),
  constraint intake_vehicle_customs_make_len check (char_length(make_label) <= 60),
  constraint intake_vehicle_customs_unique unique (kind, make_key, value_key)
);

alter table public.intake_vehicle_customs enable row level security;
revoke all on public.intake_vehicle_customs from anon, authenticated;
