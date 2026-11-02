-- Picked up (Owner 2026-10-31). Additive, idempotent. NOT applied to prod in this PR.
-- estimates.picked_up_at: vehicle picked up. Set by the "Picked up" toggle on the ops strip or the
-- Central Dispatch pickup email (inbox watch). Drives the green Operations calendar color.
alter table public.estimates add column if not exists picked_up_at timestamptz;
