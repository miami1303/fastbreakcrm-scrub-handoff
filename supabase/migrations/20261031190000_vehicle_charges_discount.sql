-- Per-vehicle Additional charges + Discount, and Customer payment per vehicle (Owner 2026-10-31).
-- Additive and idempotent. The app hides the per-vehicle cards until these columns exist
-- (lib/schema-features.ts -> vehicleCharges / paymentVehicle) and keeps the old job-level lines.
--
-- vehicles.extra_charges: up to 3 lines [{"description": "Winch", "amount": 75.00, "collect": "payment" | "cod"}]
--   collect = "payment": Fast Break takes it with the payment method; Carrier COD unchanged.
--   collect = "cod":     the carrier collects it, so it is added to the COD the carrier collects.
-- vehicles.discount_amount: comes off this vehicle's Total (and off what Fast Break collects).
--   Carrier COD stays the same. Never shown to the customer as a line.
-- payments.vehicle_index: which vehicle (0-based, in Charges order) a customer payment is for.
--   NULL = whole job (not split). One-vehicle jobs ignore it.
alter table public.vehicles add column if not exists extra_charges jsonb not null default '[]'::jsonb;
alter table public.vehicles add column if not exists discount_amount numeric(10,2);
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'vehicles_extra_charges_shape') then
    alter table public.vehicles add constraint vehicles_extra_charges_shape
      check (jsonb_typeof(extra_charges) = 'array' and jsonb_array_length(extra_charges) <= 3);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'vehicles_discount_nonneg') then
    alter table public.vehicles add constraint vehicles_discount_nonneg check (discount_amount is null or discount_amount >= 0);
  end if;
end $$;

alter table public.payments add column if not exists vehicle_index smallint;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'payments_vehicle_index_range') then
    alter table public.payments add constraint payments_vehicle_index_range check (vehicle_index is null or vehicle_index between 0 and 99);
  end if;
end $$;
