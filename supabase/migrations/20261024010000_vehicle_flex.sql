-- Per-vehicle FLEX pricing flag (Owner, 2026-10-23). Each vehicle has a FLEX checkbox; when on,
-- "FLEX" shows on that vehicle's line and in its Remarks cell on the E-Quote / E-Sign order /
-- customer e-sign page ("FLEX - <vehicle remark>" when it has one). The vehicle remarks text and
-- the job-level "Remarks:" bar are not changed. Additive only: existing rows read false.
alter table public.vehicles add column if not exists flex boolean not null default false;
