-- Expedited toggle per vehicle (Owner 2026-10-31). Same place as ASAP: the customer sees
-- EXPEDITED in this vehicle's remarks cell. Additive and nullable-safe: default false.
alter table public.vehicles add column if not exists expedited boolean not null default false;

comment on column public.vehicles.expedited is
  'When true, the customer sees EXPEDITED in this vehicle''s remarks cell (same place as ASAP).';
