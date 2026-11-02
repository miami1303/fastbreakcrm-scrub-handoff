-- Carrier paid banner + "ATTN Ops carrier paid" email (Owner 2026-10-31). Additive, idempotent.
-- estimates.carrier_paid_notified_at: when the Carrier paid banner/email went out for the current payment.
-- Null = not yet. Reset when the paid entry is undone or a new Carrier Owes amount is set.
alter table public.estimates add column if not exists carrier_paid_notified_at timestamptz;
