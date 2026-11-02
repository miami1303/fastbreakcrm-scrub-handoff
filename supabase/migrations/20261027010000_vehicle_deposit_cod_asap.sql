-- Per-vehicle Deposit, Carrier COD, Total, and ASAP (Owner, 2026-10-26).
-- Additive only. Do not apply to a live database without Owner's explicit OK.
--
-- vehicles.price is the LEGACY per-unit carrier pay (price × qty defaulted the job COD).
-- It is not the vehicle total, so it is left alone. New columns, same names as estimates:
--   deposit_amount  per-vehicle deposit
--   cod_amount      per-vehicle carrier COD (the line amount, not × qty)
--   total_amount    per-vehicle total = deposit_amount + cod_amount
-- Extra charges stay on the job. The job's deposit/cod/total are the sums of these.
--
-- NULL means "not entered under this split yet". A default of 0 would make every existing
-- vehicle look priced at $0 and hide the deposit/COD already stored on the estimate.
-- 0 means the rep entered zero. The app shows an unsplit job's deposit and COD on the
-- first vehicle until the next save, and does not drop the stored job numbers.
--
-- ASAP prints in that vehicle's remarks cell the same way FLEX does. Existing rows are false.
-- Both flags may be on together ("FLEX - ASAP").

alter table public.vehicles add column if not exists deposit_amount numeric(12,2);
alter table public.vehicles add column if not exists cod_amount numeric(12,2);
alter table public.vehicles add column if not exists total_amount numeric(12,2);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'vehicles_deposit_amount_nonneg') then
    alter table public.vehicles add constraint vehicles_deposit_amount_nonneg
      check (deposit_amount is null or deposit_amount >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'vehicles_cod_amount_nonneg') then
    alter table public.vehicles add constraint vehicles_cod_amount_nonneg
      check (cod_amount is null or cod_amount >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'vehicles_total_amount_nonneg') then
    alter table public.vehicles add constraint vehicles_total_amount_nonneg
      check (total_amount is null or total_amount >= 0);
  end if;
end $$;

alter table public.vehicles add column if not exists asap boolean not null default false;

comment on column public.vehicles.price is
  'Legacy per-unit carrier pay. Not the per-vehicle total. Total is total_amount (deposit_amount + cod_amount).';
comment on column public.vehicles.deposit_amount is
  'Per-vehicle deposit. NULL = not split yet; the job-level deposit is shown on the first vehicle.';
comment on column public.vehicles.cod_amount is
  'Per-vehicle carrier COD for the line (not multiplied by qty). NULL = not split yet.';
comment on column public.vehicles.total_amount is
  'Per-vehicle total = deposit_amount + cod_amount. Extra charges stay on the job total.';
comment on column public.vehicles.asap is
  'When true, the customer sees ASAP in this vehicle''s remarks cell (same place as FLEX).';
