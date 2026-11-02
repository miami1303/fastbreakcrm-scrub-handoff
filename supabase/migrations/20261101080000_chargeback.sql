-- Chargeback / dispute tracking (Owner 2026-10-31). Set by the Stripe webhook (charge.dispute.*).
alter table public.estimates add column if not exists chargeback_status text;
alter table public.estimates add column if not exists chargeback_at timestamptz;
alter table public.estimates add column if not exists chargeback_amount numeric(12,2);
alter table public.estimates add column if not exists chargeback_dispute_id text;
alter table public.estimates add column if not exists chargeback_notified_at timestamptz;
