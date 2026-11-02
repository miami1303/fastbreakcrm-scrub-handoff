-- Priority and unassigned lead support

alter table public.estimates add column if not exists priority integer default 3;
alter table public.estimates add column if not exists assigned_to uuid references auth.users(id);

-- Allow unassigned status
alter table public.estimates drop constraint if exists estimates_status_check;
alter table public.estimates add constraint estimates_status_check
  check (status in ('draft', 'quoted', 'signed', 'booked', 'cancelled', 'unassigned'));

-- Admins can see unassigned leads
create policy "admins see unassigned" on public.estimates
  for select using (
    status = 'unassigned' and exists (
      select 1 from public.user_profiles p where p.user_id = auth.uid() and p.role in ('admin','supervisor')
    )
  );
