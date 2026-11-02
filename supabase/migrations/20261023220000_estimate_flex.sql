-- FLEX pricing flag (Owner, 2026-10-23). Rep ticks "FLEX" next to the Total on the charges
-- screen (saved by Submit Charges). When true, the E-Quote / booked order / customer page print
-- "FLEX" in each vehicle row's Remarks cell ("FLEX - <vehicle remark>" when it has one).
-- Additive only: no data change; existing rows read false. The job-level "Remarks:" is untouched.
alter table public.estimates add column if not exists flex boolean not null default false;
