-- Payments stage. ADDS tables and columns only. Does not delete or rename anything.
-- Do not apply this to the live database until Owner says so.
--
-- In plain words:
-- 1. A customer is the person, separate from one lead. Stripe cards are saved on the person.
-- 2. A lead can point at that person. Staff match by name OR phone OR email.
-- 3. Each lead stores whether auto-charge is on for that booking (including an online booking).
-- 4. Auto-charge does NOT get its own signature columns. It reads the e-sign page that
--    already exists: a signed contract is a booked_esign email with a "signed" event, and a
--    signed credit card form is a cc_form email with a "signed" event. Both must exist.
-- 5. Saved Stripe cards store Stripe ids plus brand, last 4, expiration, and the original
--    job number. Full card numbers are not stored in these new tables.
-- 6. Old payment rows are unchanged. New columns are optional. A negative amount stays a
--    bookkeeping correction (charge_status = bookkeeping_adjustment) and must not move money.
-- 7. Rows that Stripe has not confirmed (processing, failed, waiting) do not count as paid.

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  display_name text not null default '',
  email text,
  phone text,
  name_normalized text not null default '',
  email_normalized text not null default '',
  phone_digits text not null default '',
  stripe_customer_id text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists customers_name_normalized_idx on public.customers (name_normalized);
create index if not exists customers_email_normalized_idx on public.customers (email_normalized);
create index if not exists customers_phone_digits_idx on public.customers (phone_digits);

alter table public.estimates
  add column if not exists customer_id uuid references public.customers (id) on delete set null;

alter table public.estimates
  add column if not exists auto_charge_enabled boolean not null default false;

comment on column public.estimates.auto_charge_enabled is
  'Per booking, including an online booking. When true, a Stripe card may be charged only after both e-signs exist (signed booked_esign AND signed cc_form). Default off.';

create table if not exists public.customer_payment_methods (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete cascade,
  stripe_customer_id text,
  stripe_payment_method_id text,
  brand text,
  last4 text,
  exp_month integer,
  exp_year integer,
  original_job_number text,
  original_estimate_id uuid references public.estimates (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint customer_payment_methods_last4_chk check (last4 is null or last4 ~ '^[0-9]{4}$')
);

create unique index if not exists customer_payment_methods_customer_pm_idx
  on public.customer_payment_methods (customer_id, stripe_payment_method_id);

create index if not exists customer_payment_methods_customer_idx
  on public.customer_payment_methods (customer_id);

alter table public.payments add column if not exists charge_status text;
alter table public.payments add column if not exists auto_charge boolean not null default false;
alter table public.payments add column if not exists idempotency_key text;
alter table public.payments add column if not exists stripe_payment_intent_id text;
alter table public.payments add column if not exists stripe_checkout_session_id text;
alter table public.payments add column if not exists stripe_setup_intent_id text;
alter table public.payments add column if not exists stripe_payment_method_id text;
alter table public.payments add column if not exists customer_id uuid references public.customers (id) on delete set null;

alter table public.payments drop constraint if exists payments_charge_status_chk;
alter table public.payments add constraint payments_charge_status_chk check (
  charge_status is null or charge_status in (
    'recorded',
    'logged_manual',
    'bookkeeping_adjustment',
    'pending',
    'processing',
    'succeeded',
    'failed',
    'auto_charge_waiting',
    'superseded'
  )
);

create unique index if not exists payments_idempotency_key_idx on public.payments (idempotency_key);
create unique index if not exists payments_stripe_payment_intent_idx on public.payments (stripe_payment_intent_id);
create unique index if not exists payments_stripe_checkout_session_idx on public.payments (stripe_checkout_session_id);

create table if not exists public.payment_links (
  id uuid primary key default gen_random_uuid(),
  estimate_id uuid not null references public.estimates (id) on delete restrict,
  amount numeric(12,2) not null check (amount > 0),
  url text not null,
  stripe_checkout_session_id text unique,
  idempotency_key text unique,
  is_deposit boolean not null default true,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);

create index if not exists payment_links_estimate_idx on public.payment_links (estimate_id, created_at);

alter table public.customers enable row level security;
alter table public.customer_payment_methods enable row level security;
alter table public.payment_links enable row level security;

revoke all on table public.customers from anon, authenticated;
revoke all on table public.customer_payment_methods from anon, authenticated;
revoke all on table public.payment_links from anon, authenticated;

grant select, insert, update, delete on table public.customers to service_role;
grant select, insert, update, delete on table public.customer_payment_methods to service_role;
grant select, insert, update, delete on table public.payment_links to service_role;
