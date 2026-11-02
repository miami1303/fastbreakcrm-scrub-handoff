-- Third optional phone line on pickup and delivery.
-- Additive only. Existing rows leave these null, and a blank line is not printed.
-- This file is not applied to any database by the change that added it.
-- Apply it before Phone 3 will be saved. Until then the form still works
-- and phones 1 and 2 save as they do today.
--
-- Names match pickup_phone1 / pickup_phone1_label (migration 20261026210000).
-- phone_search is unchanged: it is a stored generated column over phones 1 and 2.
-- Rebuilding it is not part of this additive change, so a search still matches
-- the customer phone and phones 1 and 2, not phone 3.

alter table public.estimates
  add column if not exists pickup_phone3 text,
  add column if not exists pickup_phone3_label text,
  add column if not exists delivery_phone3 text,
  add column if not exists delivery_phone3_label text;
