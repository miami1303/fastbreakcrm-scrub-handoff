-- Add date fields for salesman workflow and operations calendar

alter table public.estimates
  add column if not exists primary_date date,
  add column if not exists backup_date date,
  add column if not exists follow_up_at timestamptz,
  add column if not exists assigned_to uuid references auth.users(id),
  add column if not exists lead_source text;

-- Allow status for unassigned leads
alter table public.estimates drop constraint if exists estimates_status_check;
alter table public.estimates add constraint estimates_status_check
  check (status in ('draft', 'quoted', 'signed', 'booked', 'cancelled', 'unassigned'));
