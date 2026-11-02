-- Company priority labels (Maintenance). Each CRM company keeps its own list:
-- a number 1-9 and a label. A company with no rows has no priorities.
-- This file is not applied by the change that added it. Apply it before labels can be edited.
-- Until then the app treats the list as empty and still shows a lead's stored number.
--
-- Additive only. estimates.priority is not rewritten. Existing numbers stay.
-- The check is widened from 0-8 to 0-9 so a label of 9 can be saved, and 0 (already
-- stored on older leads) stays valid. Null stays valid. The column default becomes
-- blank so a new lead is unset unless the app sets a number.
-- The old crm_settings key "priority_labels" is left in place and is no longer read.
-- follow_up_items.priority (1-5) is a different, unused table and is not changed.

create table if not exists public.priority_labels (
  number smallint primary key,
  label text not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  constraint priority_labels_number_range check (number between 1 and 9),
  constraint priority_labels_label_len check (char_length(btrim(label)) between 1 and 60)
);

-- Fast Break seed. Editable rows, not a code fallback. on conflict do nothing
-- so a later edit is not overwritten if this file is applied again.
insert into public.priority_labels (number, label) values
  (1, 'Quoted'),
  (3, 'Not interested'),
  (8, 'Wrong number / bad / discard')
on conflict (number) do nothing;

alter table public.priority_labels enable row level security;

drop policy if exists "staff read priority labels" on public.priority_labels;
create policy "staff read priority labels" on public.priority_labels
  for select to authenticated
  using ((select public.crm_is_active_staff()));

drop policy if exists "admins manage priority labels" on public.priority_labels;
create policy "admins manage priority labels" on public.priority_labels
  for all to authenticated
  using ((select public.crm_is_active_admin()))
  with check ((select public.crm_is_active_admin()));

grant select, insert, update, delete on public.priority_labels to authenticated;

alter table public.estimates alter column priority drop default;

alter table public.estimates drop constraint if exists estimates_priority_range;
alter table public.estimates add constraint estimates_priority_range
  check (priority is null or priority between 0 and 9);
