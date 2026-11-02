-- Four append-only note sections on the lead, and automatic mileage.

-- Notes: rep remarks, company-policy additions (printed in that lead's Terms & Conditions),
-- customer remarks, direction / operation details. Corrections go in as a new entry.
alter table public.estimate_notes add column if not exists kind text not null default 'rep';
alter table public.estimate_notes drop constraint if exists estimate_notes_kind_check;
alter table public.estimate_notes add constraint estimate_notes_kind_check
  check (kind in ('rep', 'policy', 'customer', 'operations'));
create index if not exists estimate_notes_kind_idx on public.estimate_notes (estimate_id, kind, created_at desc);
drop trigger if exists estimate_notes_append_only on public.estimate_notes;
create trigger estimate_notes_append_only before update or delete on public.estimate_notes
  for each row execute function public.crm_reject_history_change();

-- Earlier free-text Customer Remarks / Operation Details become the first entry of their section.
insert into public.estimate_notes (estimate_id, kind, author_name, body, created_at)
  select id, 'customer', 'Imported', customer_remarks, coalesce(updated_at, created_at) from public.estimates
  where coalesce(trim(customer_remarks), '') <> ''
    and not exists (select 1 from public.estimate_notes n where n.estimate_id = estimates.id and n.kind = 'customer');
insert into public.estimate_notes (estimate_id, kind, author_name, body, created_at)
  select id, 'operations', 'Imported', operation_details, coalesce(updated_at, created_at) from public.estimates
  where coalesce(trim(operation_details), '') <> ''
    and not exists (select 1 from public.estimate_notes n where n.estimate_id = estimates.id and n.kind = 'operations');

-- Quick Notes presets for Representative's Remarks (admin can change the list).
insert into public.crm_settings (key, value) values
  ('quick_notes', '["Left VM, sent email & text"]'::jsonb)
on conflict (key) do nothing;

-- Mileage between the pickup and delivery ZIPs (free sources: zippopotam.us lat/lon + public OSRM).
alter table public.estimates add column if not exists miles integer check (miles is null or miles between 0 and 10000);
alter table public.estimates add column if not exists miles_source text check (miles_source in ('osrm', 'estimate', 'manual'));
alter table public.estimates add column if not exists miles_zips text; -- "33313-80126": the ZIP pair the miles were computed for

create table if not exists public.zip_geo (
  zip text primary key check (zip ~ '^[0-9]{5}$'),
  city text, state text, lat double precision not null, lon double precision not null,
  fetched_at timestamptz not null default now()
);
alter table public.zip_geo enable row level security;
revoke all on public.zip_geo from anon, authenticated;
