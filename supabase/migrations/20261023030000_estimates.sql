-- Estimates, vehicles, and quotes for the Fast Break CRM booking flow

create table if not exists public.estimates (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  customer_name text not null,
  customer_email text,
  customer_phone text,
  pickup_address text not null,
  pickup_phone1 text,
  pickup_phone2 text,
  delivery_address text not null,
  delivery_phone1 text,
  delivery_phone2 text,
  status text not null default 'draft' check (status in ('draft', 'quoted', 'signed', 'booked', 'cancelled')),
  deposit_amount numeric(12,2),
  total_amount numeric(12,2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.vehicles (
  id uuid primary key default gen_random_uuid(),
  estimate_id uuid not null references public.estimates(id) on delete cascade,
  year integer,
  make text,
  model text,
  vehicle_type text,
  is_running boolean not null default true,
  is_enclosed boolean not null default false,
  remarks text,
  created_at timestamptz not null default now()
);

create table if not exists public.quotes (
  id uuid primary key default gen_random_uuid(),
  estimate_id uuid not null references public.estimates(id) on delete cascade,
  deposit_amount numeric(12,2) not null,
  total_amount numeric(12,2) not null,
  cardholder_name text,
  billing_address text,
  card_last4 text,
  card_exp text,
  signed_at timestamptz,
  booked_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.estimates enable row level security;
alter table public.vehicles enable row level security;
alter table public.quotes enable row level security;

create policy "owners manage own estimates" on public.estimates
  for all using (owner_id = auth.uid());

create policy "owners manage vehicles via estimate" on public.vehicles
  for all using (
    exists (select 1 from public.estimates e where e.id = estimate_id and e.owner_id = auth.uid())
  );

create policy "owners manage quotes via estimate" on public.quotes
  for all using (
    exists (select 1 from public.estimates e where e.id = estimate_id and e.owner_id = auth.uid())
  );
