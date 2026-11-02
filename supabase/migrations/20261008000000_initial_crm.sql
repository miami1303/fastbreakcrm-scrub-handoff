-- Fastbreak CRM: authentication and Follow Up data.
-- Apply only to the existing authorized Fast Break Supabase project.
create table if not exists public.user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  role text not null check (role in ('admin', 'supervisor', 'salesperson')),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.follow_up_items (
  id uuid primary key default gen_random_uuid(),
  customer_name text not null,
  subject text not null,
  due_at timestamptz not null,
  status text not null default 'Open' check (status in ('Open', 'Completed')),
  owner_id uuid not null references public.user_profiles(user_id),
  created_at timestamptz not null default now()
);

create index if not exists follow_up_items_due_at_idx on public.follow_up_items (due_at);
create index if not exists follow_up_items_owner_due_idx on public.follow_up_items (owner_id, due_at);

alter table public.user_profiles enable row level security;
alter table public.follow_up_items enable row level security;

create or replace function public.crm_is_active_admin_or_supervisor()
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
      and p.role in ('admin', 'supervisor')
  );
$$;

revoke all on function public.crm_is_active_admin_or_supervisor() from public;
grant execute on function public.crm_is_active_admin_or_supervisor() to authenticated;

drop policy if exists "Users can read their own active profile" on public.user_profiles;
create policy "Users can read their own active profile"
  on public.user_profiles for select to authenticated
  using (user_id = (select auth.uid()) and is_active = true);

drop policy if exists "Active team can read allowed follow ups" on public.follow_up_items;
create policy "Active team can read allowed follow ups"
  on public.follow_up_items for select to authenticated
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

grant select on public.user_profiles to authenticated;
grant select, insert, update, delete on public.follow_up_items to authenticated;
