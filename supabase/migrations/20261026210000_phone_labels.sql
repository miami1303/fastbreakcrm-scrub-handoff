-- Phone line labels on an estimate (Cell, Home, Work, Other, or blank).
-- Additive only. Existing rows keep a blank label and still show the number.
-- This file is not applied to any database by the change that added it.
-- Apply it before phone labels will be saved. Until then the form still works
-- and numbers save as they do today.

alter table public.estimates
  add column if not exists pickup_phone1_label text,
  add column if not exists pickup_phone2_label text,
  add column if not exists delivery_phone1_label text,
  add column if not exists delivery_phone2_label text;
