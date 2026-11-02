-- Carrier Owes + F.A.D. / Delivery date windows + Delivered stamp (Owner 2026-10-31). Additive, idempotent.
-- BACK OFFICE ONLY. None of these columns feed the customer quote, order, deposit, balance or total.
--
-- estimates.carrier_owes_amount      what the carrier owes Fast Break at delivery (e.g. 100.00).
--                                    NULL / 0 = nothing owed. Never changes Deposit, COD, Total or Balance.
-- estimates.carrier_owes_paid_at     manual "Carrier paid" entry. Stops the Carrier Owes banner. Pricing unchanged.
-- estimates.carrier_owes_paid_by_name / carrier_owes_paid_note   who recorded it + optional confirmation / note.
-- estimates.carrier_owes_notified_at the "carrier owes us money" banner + email went out (sent once per delivery).
-- estimates.delivered_at             vehicle delivered (manual "Delivered?" button on the ops strip).
-- estimates.fad_start / fad_end      F.A.D. (First Available Delivery) window, two dates.
-- estimates.delivery_window_start / delivery_window_end   delivery date window the carrier gives.
alter table public.estimates add column if not exists carrier_owes_amount numeric(10,2);
alter table public.estimates add column if not exists carrier_owes_paid_at timestamptz;
alter table public.estimates add column if not exists carrier_owes_paid_by_name text;
alter table public.estimates add column if not exists carrier_owes_paid_note text;
alter table public.estimates add column if not exists carrier_owes_notified_at timestamptz;
alter table public.estimates add column if not exists delivered_at timestamptz;
alter table public.estimates add column if not exists fad_start date;
alter table public.estimates add column if not exists fad_end date;
alter table public.estimates add column if not exists delivery_window_start date;
alter table public.estimates add column if not exists delivery_window_end date;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'estimates_carrier_owes_nonneg') then
    alter table public.estimates add constraint estimates_carrier_owes_nonneg check (carrier_owes_amount is null or carrier_owes_amount >= 0);
  end if;
end $$;
