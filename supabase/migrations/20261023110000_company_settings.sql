-- Company contact info shown on every customer document and email.
-- Admin-editable in the CRM (Admin > Company Settings); read at render/send time,
-- so changing a phone number or email needs no code change or redeploy.
create table if not exists public.company_settings (
  key text primary key,
  value text not null default '',
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

insert into public.company_settings (key, value) values
  ('main_phone', '555-010-0101'),
  ('company_email', 'support@fastbreakcrm.test'),
  ('website', 'fastbreakcrm.test'),
  ('address', 'Demo City, ST'),
  ('quote_company_name', 'Fastbreak CRM'),
  ('cc_company_name', 'FAST BREAK CRM DEMO'),
  ('email_from_name', 'Fastbreak CRM'),
  ('us_dot', '0000000'),
  ('icc_mc', '000000')
on conflict (key) do nothing;

alter table public.company_settings enable row level security;

-- Any active staff member may read (the CRM header shows the main phone).
drop policy if exists "staff read company settings" on public.company_settings;
create policy "staff read company settings" on public.company_settings
  for select to authenticated
  using (exists (select 1 from public.user_profiles p where p.user_id = auth.uid() and p.is_active));

-- Writes go through the admin-only server action (service role); no direct client writes.
revoke insert, update, delete on public.company_settings from anon, authenticated;
