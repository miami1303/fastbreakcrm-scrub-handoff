-- Roles: Salesman (role 'salesperson'), Supervisor, Admin.
--   Salesman   : own leads (+ the Assign New Estimates pool when can_claim_unassigned).
--   Supervisor : sees all leads, like an admin, but no Maintenance (users / company settings).
--   Admin      : sees all; only role allowed to change users, reps and company settings.
-- Enforced here in RLS for any direct (anon-key) database access; the server actions
-- check the same rules before using the service role.

alter table public.user_profiles add column if not exists can_claim_unassigned boolean not null default false;

create or replace function public.crm_is_active_staff()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.user_profiles p where p.user_id = (select auth.uid()) and p.is_active = true);
$$;
revoke all on function public.crm_is_active_staff() from public;
grant execute on function public.crm_is_active_staff() to authenticated;

create or replace function public.crm_can_claim_unassigned()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.user_profiles p where p.user_id = (select auth.uid()) and p.is_active = true
    and (p.role in ('admin', 'supervisor') or p.can_claim_unassigned));
$$;
revoke all on function public.crm_can_claim_unassigned() from public;
grant execute on function public.crm_can_claim_unassigned() to authenticated;

-- Deactivated users lose all access to jobs, even ones they own (RESTRICTIVE = AND-ed with the others).
drop policy if exists "only active staff touch estimates" on public.estimates;
create policy "only active staff touch estimates" on public.estimates as restrictive for all to authenticated
  using ((select public.crm_is_active_staff())) with check ((select public.crm_is_active_staff()));
drop policy if exists "only active staff touch vehicles" on public.vehicles;
create policy "only active staff touch vehicles" on public.vehicles as restrictive for all to authenticated
  using ((select public.crm_is_active_staff())) with check ((select public.crm_is_active_staff()));
drop policy if exists "only active staff touch quotes" on public.quotes;
create policy "only active staff touch quotes" on public.quotes as restrictive for all to authenticated
  using ((select public.crm_is_active_staff())) with check ((select public.crm_is_active_staff()));

-- Salesmen who are allowed may see the Assign New Estimates pool (read only; claiming
-- goes through the server action, which assigns the lead to themselves).
drop policy if exists "allowed salesmen see unassigned pool" on public.estimates;
create policy "allowed salesmen see unassigned pool" on public.estimates for select to authenticated
  using (status = 'unassigned' and assigned_rep_id is null and (select public.crm_can_claim_unassigned()));

-- Maintenance tables: admins only for writes.
drop policy if exists "admins manage reps" on public.crm_reps;
create policy "admins manage reps" on public.crm_reps for all to authenticated
  using ((select public.crm_is_active_admin())) with check ((select public.crm_is_active_admin()));
grant insert, update on public.crm_reps to authenticated;

grant insert, update on public.company_settings to authenticated;
drop policy if exists "admins manage company settings" on public.company_settings;
create policy "admins manage company settings" on public.company_settings for all to authenticated
  using ((select public.crm_is_active_admin())) with check ((select public.crm_is_active_admin()));
