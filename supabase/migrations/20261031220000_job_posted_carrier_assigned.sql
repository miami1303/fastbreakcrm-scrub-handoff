-- Manual ops until Central Dispatch (Owner 2026-10-31). Additive only; not applied to prod in this PR.
-- posted_at: "Job Posted" button stamp. carrier_assigned_at: newest carrier assignment on a booked job
-- (set when a Carrier Info note is added). crm_notifications.kind has no check constraint, so the new
-- 'job_assigned' notification kind (Job Assigned banner) needs no schema change.
alter table public.estimates add column if not exists posted_at timestamptz;
alter table public.estimates add column if not exists carrier_assigned_at timestamptz;
