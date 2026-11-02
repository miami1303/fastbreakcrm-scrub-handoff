-- Enable the Follow Up actions used by the CRM menus.
-- Safe to re-run: policies are dropped before they are recreated.
drop policy if exists "Active users can create their own follow ups" on public.follow_up_items;
create policy "Active users can create their own follow ups"
  on public.follow_up_items for insert to authenticated
  with check (
    owner_id = (select auth.uid())
    and exists (
      select 1 from public.user_profiles p
      where p.user_id = (select auth.uid()) and p.is_active = true
    )
  );

drop policy if exists "Owners and admins can update follow ups" on public.follow_up_items;
create policy "Owners and admins can update follow ups"
  on public.follow_up_items for update to authenticated
  using (
    exists (
      select 1 from public.user_profiles p
      where p.user_id = (select auth.uid()) and p.is_active = true
    )
    and (
      owner_id = (select auth.uid())
      or (select public.crm_is_active_admin_or_supervisor())
    )
  )
  with check (
    exists (
      select 1 from public.user_profiles p
      where p.user_id = (select auth.uid()) and p.is_active = true
    )
    and (
      owner_id = (select auth.uid())
      or (select public.crm_is_active_admin_or_supervisor())
    )
  );

drop policy if exists "Owners and admins can delete follow ups" on public.follow_up_items;
create policy "Owners and admins can delete follow ups"
  on public.follow_up_items for delete to authenticated
  using (
    exists (
      select 1 from public.user_profiles p
      where p.user_id = (select auth.uid()) and p.is_active = true
    )
    and (
      owner_id = (select auth.uid())
      or (select public.crm_is_active_admin_or_supervisor())
    )
  );

grant select, insert, update, delete on public.follow_up_items to authenticated;
