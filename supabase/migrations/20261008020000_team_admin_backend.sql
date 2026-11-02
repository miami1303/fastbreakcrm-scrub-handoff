-- Admin-only team visibility and backend support for the Team Management screen.
create index if not exists user_profiles_role_active_idx
  on public.user_profiles (role, is_active);

create or replace function public.crm_is_active_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.user_profiles p
    where p.user_id = (select auth.uid())
      and p.is_active = true
      and p.role = 'admin'
  );
$$;

revoke all on function public.crm_is_active_admin() from public;
grant execute on function public.crm_is_active_admin() to authenticated;

drop policy if exists "Active admins can read all profiles" on public.user_profiles;
create policy "Active admins can read all profiles"
  on public.user_profiles for select to authenticated
  using ((select public.crm_is_active_admin()));

drop policy if exists "Active admins can update profiles" on public.user_profiles;
create policy "Active admins can update profiles"
  on public.user_profiles for update to authenticated
  using ((select public.crm_is_active_admin()))
  with check ((select public.crm_is_active_admin()));
