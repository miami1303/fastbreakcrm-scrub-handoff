-- Return to carrier (Owner, 2026-10-31). Money Fast Break sends a carrier out of the deposit.
-- Its own table: it is never a customer payment, so the customer's payments and balance do not change.
-- Two modes (toggle next to Return to carrier, Owner 2026-10-31):
--   source = 'deposit' : sent to the carrier now, out of Fast Break's deposit (Zelle / Cash App).
--   source = 'cod'     : added to the carrier COD so the car gets picked up without taking from the
--                        deposit. Nothing is sent now; status = 'added_to_cod'.
-- Every row stays in accounting (Payment Records), including sent, queued, and added-to-COD rows.
--   Zelle    : direct from Fast Break's bank. Stripe never touches Zelle. There is no Zelle API
--              on a normal business account, so the CRM queues it as "zelle_to_send" (ASAP) and the
--              office sends it in the bank app, then marks it sent with the Zelle confirmation number.
--   Cash App : through Stripe (Stripe Connect transfer to the carrier's connected account acct_...,
--              which pays out to their bank / Cash App debit card).
create table if not exists public.carrier_payouts (
  id uuid primary key default gen_random_uuid(),
  estimate_id uuid not null references public.estimates (id) on delete restrict,
  amount numeric(12,2) not null check (amount > 0),
  source text not null default 'deposit' check (source in ('deposit', 'cod')),
  method text check (method is null or method in ('Zelle', 'Cash App')),
  carrier_name text,
  pay_to text,
  status text not null check (status in ('zelle_to_send', 'processing', 'sent', 'failed', 'cancelled', 'added_to_cod')),
  stripe_transfer_id text unique,
  confirmation_no text,
  memo text,
  remark text,
  idempotency_key text unique,
  created_by uuid references auth.users (id),
  created_by_name text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  sent_by_name text,
  constraint carrier_payouts_mode_chk check (
    (source = 'deposit' and method is not null and pay_to is not null and status <> 'added_to_cod')
    or (source = 'cod' and status in ('added_to_cod', 'cancelled'))
  )
);

create index if not exists carrier_payouts_estimate_idx on public.carrier_payouts (estimate_id, created_at);
create index if not exists carrier_payouts_open_zelle_idx on public.carrier_payouts (status) where status = 'zelle_to_send';

alter table public.carrier_payouts enable row level security;
revoke all on table public.carrier_payouts from anon, authenticated;
