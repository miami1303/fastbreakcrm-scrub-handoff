-- Auto-charge switch on the lead (Owner, 2026-10-26). Additive only. Do not apply
-- to a live database without Owner's explicit OK.
--
-- This is not a payment method. The payment-method dropdown is unchanged.
-- auto_charge: staff asked to charge the saved card once after both e-signs.
-- auto_charged_at: set when that charge is claimed, so a second sign or a
-- second save cannot charge the card again. Cleared if the charge itself fails.
-- The switch stays off in the app until Stripe is actually connected.

alter table public.estimates add column if not exists auto_charge boolean not null default false;
alter table public.estimates add column if not exists auto_charged_at timestamptz;

comment on column public.estimates.auto_charge is
  'When true and Stripe is connected, charge the saved card once after both e-signs. Off until Stripe is connected.';
comment on column public.estimates.auto_charged_at is
  'When the auto-charge was claimed. Null means it has not charged. Stops a second charge.';
