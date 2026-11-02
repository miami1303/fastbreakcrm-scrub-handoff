-- Core CRM flow: rep list + rotation, booking, encrypted payments with access log,
-- append-only Email Center history with e-sign/view events, notes, and banner notifications.
-- New migration only; earlier migrations are unchanged. Safe to re-run (idempotent).

-- ---------------------------------------------------------------------------
-- Estimates: unassigned leads have no owner yet; booking + "touched" timestamps.
-- ---------------------------------------------------------------------------
alter table public.estimates alter column owner_id drop not null;
alter table public.estimates
  add column if not exists pickup_zip text,
  add column if not exists delivery_zip text,
  add column if not exists assigned_rep_id uuid,
  add column if not exists booked_at timestamptz,
  add column if not exists last_touched_at timestamptz,
  add column if not exists created_by uuid references auth.users(id),
  add column if not exists pickup_contact text,
  add column if not exists delivery_contact text,
  add column if not exists extra_stop_notes text,   -- printed in the middle of the customer quote
  add column if not exists customer_remarks text,
  add column if not exists operation_details text,  -- operations only, never on customer docs
  add column if not exists deleted_at timestamptz,  -- soft delete (admin only)
  add column if not exists deleted_by uuid references auth.users(id);

-- Prices: DEPOSIT (quoted) + COD (paid to the carrier on delivery) = TOTAL (calculated in
-- the app). The deposit shown to the customer on booked documents comes from payments
-- marked Deposit, not from this quoted deposit.
alter table public.estimates add column if not exists cod_amount numeric(12,2);
alter table public.quotes add column if not exists cod_amount numeric(12,2);

-- Priorities 0-4 (0 brand-new, 1 needs follow-up, 2 didn't touch, 3 wrong number, 4 other/dead).
alter table public.estimates alter column priority set default 0;
update public.estimates set priority = 4 where priority > 4;
update public.estimates set priority = 0 where priority < 0;
do $$ begin
  alter table public.estimates add constraint estimates_priority_range check (priority between 0 and 4);
exception when duplicate_object then null; end $$;

-- Search: digits-only phone numbers (last 10 digits, so 1-816-555-1234, (816) 555-1234,
-- 8165551234 and 18165551234 all match).
create or replace function public.crm_phone10(p text) returns text language sql immutable as
  $$ select right(regexp_replace(coalesce(p, ''), '\D', '', 'g'), 10) $$;
alter table public.estimates add column if not exists phone_search text
  generated always as (
    public.crm_phone10(customer_phone) || ' ' || public.crm_phone10(pickup_phone1) || ' ' ||
    public.crm_phone10(pickup_phone2) || ' ' || public.crm_phone10(delivery_phone1) || ' ' ||
    public.crm_phone10(delivery_phone2)
  ) stored;

-- Job numbers: FB + sequence (starts 40001 in 20261023050000); 'FB' || nextval rolls to
-- 6 digits after FB99999 on its own. The sequence keeps numbers unique under concurrency.

-- ---------------------------------------------------------------------------
-- Sales reps (assignment list + rep block on customer documents). Seeded with
-- Jordan Demo and Sam Rep (email support@fastbreakcrm.test, phone blank
-- until the new phone system is set up). Email/phone are editable in Admin -> Settings. user_id links a rep to a
-- CRM login so the job shows up in that person's menu; link it in SQL if the
-- auto-link below doesn't find the right profile:
--   update public.crm_reps set user_id = '<auth user id>' where name = 'Sam Rep';
-- ---------------------------------------------------------------------------
create table if not exists public.crm_reps (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  email text,
  phone text,
  user_id uuid unique references auth.users(id) on delete set null,
  is_active boolean not null default true,
  sort_order integer not null default 100,
  in_rotation boolean not null default true,
  last_assigned_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.crm_reps
  add column if not exists email text,
  add column if not exists phone text,
  add column if not exists in_rotation boolean not null default true,
  add column if not exists last_assigned_at timestamptz;

insert into public.crm_reps (name, email, sort_order) values
  ('Jordan Demo', 'support@fastbreakcrm.test', 10),
  ('Sam Rep', 'support@fastbreakcrm.test', 20)
  on conflict (name) do nothing;

-- Auto-link seeded reps to an existing profile whose display name matches the rep's
-- full name or first name (e.g. "Sam" or "Sam Rep").
update public.crm_reps r set user_id = p.user_id
  from public.user_profiles p
  where r.user_id is null
    and p.is_active
    and (lower(trim(p.display_name)) = lower(r.name)
         or lower(trim(p.display_name)) = lower(split_part(r.name, ' ', 1)))
    and not exists (select 1 from public.crm_reps r2 where r2.user_id = p.user_id);

do $$ begin
  alter table public.estimates
    add constraint estimates_assigned_rep_fk foreign key (assigned_rep_id) references public.crm_reps(id) on delete set null;
exception when duplicate_object then null; end $$;

alter table public.crm_reps enable row level security;
drop policy if exists "active staff read reps" on public.crm_reps;
create policy "active staff read reps" on public.crm_reps for select to authenticated
  using (exists (select 1 from public.user_profiles p where p.user_id = (select auth.uid()) and p.is_active));
grant select on public.crm_reps to authenticated;

-- Who may open full card details (admins always may; see lib/payments-server.ts).
alter table public.user_profiles add column if not exists can_view_cards boolean not null default false;

-- ---------------------------------------------------------------------------
-- Admin/supervisor access to every job (Assign New Estimates, job pages, reports).
-- Owners keep the existing "owners manage ..." policies.
-- ---------------------------------------------------------------------------
drop policy if exists "admins manage all estimates" on public.estimates;
create policy "admins manage all estimates" on public.estimates for all to authenticated
  using ((select public.crm_is_active_admin_or_supervisor()))
  with check ((select public.crm_is_active_admin_or_supervisor()));

drop policy if exists "admins manage all vehicles" on public.vehicles;
create policy "admins manage all vehicles" on public.vehicles for all to authenticated
  using ((select public.crm_is_active_admin_or_supervisor()))
  with check ((select public.crm_is_active_admin_or_supervisor()));

drop policy if exists "admins manage all quotes" on public.quotes;
create policy "admins manage all quotes" on public.quotes for all to authenticated
  using ((select public.crm_is_active_admin_or_supervisor()))
  with check ((select public.crm_is_active_admin_or_supervisor()));

grant select, insert, update, delete on public.estimates, public.vehicles, public.quotes to authenticated;

-- quotes upsert(onConflict: estimate_id) needs this (also in 20261023070000).
create unique index if not exists quotes_estimate_id_key on public.quotes (estimate_id);

-- ---------------------------------------------------------------------------
-- Payments. Full card number + CVV are stored ONLY as AES-256-GCM ciphertext
-- (card_secret_enc), encrypted in the app with CARD_ENCRYPTION_KEY, which never
-- reaches the database. No grants to anon/authenticated: the table is read and
-- written only by server code (service role) after a role check, and every
-- full-detail view is written to card_access_log.
-- ---------------------------------------------------------------------------
create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  estimate_id uuid not null references public.estimates(id) on delete cascade,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  created_by_name text,
  payment_date date,
  method text not null default 'Credit Card',
  is_deposit boolean not null default false,
  amount numeric(12,2) not null,
  confirmation_no text,
  remark text,
  cardholder_name text,
  billing_address text,
  billing_city text,
  billing_state text,
  billing_zip text,
  phone text,
  email text,
  card_type text,
  card_last4 text,
  card_exp text,
  card_secret_enc text,
  key_version text,
  provider text not null default 'manual',
  voided_at timestamptz,
  voided_by uuid references auth.users(id)
);
create index if not exists payments_estimate_idx on public.payments (estimate_id, created_at);
alter table public.payments enable row level security;
revoke all on public.payments from anon, authenticated;

create table if not exists public.card_access_log (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid references public.payments(id) on delete set null,
  estimate_id uuid references public.estimates(id) on delete set null,
  user_id uuid references auth.users(id),
  user_name text,
  action text not null check (action in ('view', 'denied', 'create')),
  ip text,
  user_agent text,
  created_at timestamptz not null default now()
);
alter table public.card_access_log enable row level security;
revoke all on public.card_access_log from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Lead rotation settings. rotation_enabled = false until an admin turns it on in
-- Admin Menu -> Settings. crm_next_rotation_rep() hands out leads round-robin to
-- active reps with in_rotation = true that are linked to a login.
-- ---------------------------------------------------------------------------
create table if not exists public.crm_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);
insert into public.crm_settings (key, value) values
  ('rotation_enabled', 'false'::jsonb),
  ('priority_labels', '["Brand-new lead","Needs follow-up","Didn''t touch","Wrong number","Other / dead"]'::jsonb)
  on conflict (key) do nothing;
alter table public.crm_settings enable row level security;
revoke all on public.crm_settings from anon, authenticated;

create or replace function public.crm_next_rotation_rep()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  picked uuid;
begin
  select r.id into picked
    from public.crm_reps r
    where r.is_active and r.in_rotation and r.user_id is not null
    order by r.last_assigned_at asc nulls first, r.sort_order, r.name
    limit 1
    for update skip locked;
  if picked is not null then
    update public.crm_reps set last_assigned_at = now() where id = picked;
  end if;
  return picked;
end;
$$;
revoke all on function public.crm_next_rotation_rep() from public, anon, authenticated;
grant execute on function public.crm_next_rotation_rep() to service_role;

-- ---------------------------------------------------------------------------
-- Lead notes (timestamped, by rep). Adding a note or sending an email "touches" the lead
-- (estimates.last_touched_at), which clears a due follow-up.
-- ---------------------------------------------------------------------------
create table if not exists public.estimate_notes (
  id uuid primary key default gen_random_uuid(),
  estimate_id uuid not null references public.estimates(id) on delete cascade,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  author_name text,
  body text not null
);
create index if not exists estimate_notes_estimate_idx on public.estimate_notes (estimate_id, created_at desc);
alter table public.estimate_notes enable row level security;
revoke all on public.estimate_notes from anon, authenticated;

-- Email Center history. APPEND-ONLY: rows can be inserted but never updated or deleted,
-- by anyone (no UPDATE/DELETE policies or grants, and a trigger rejects it even for the
-- service role / admins). Views, opens and signatures are separate append-only rows in
-- crm_email_events that point at the email row.
--   kind: 'cc_form'      Credit Card Authorization Form (always with e-sign)
--         'e_quote'      Auto Transport Order for Service, total only, no e-sign
--         'booked_esign' Auto Transport Order for Service with e-sign, deposit + balance
create table if not exists public.crm_emails (
  id uuid primary key default gen_random_uuid(),
  estimate_id uuid not null references public.estimates(id) on delete restrict,
  token text not null unique,
  kind text not null check (kind in ('cc_form', 'e_quote', 'booked_esign')),
  subject text not null,
  sent_to text,
  sent_by uuid references auth.users(id),
  sent_by_name text,
  doc_sha256 text,
  created_at timestamptz not null default now()
);
create index if not exists crm_emails_estimate_idx on public.crm_emails (estimate_id, created_at desc);

create table if not exists public.crm_email_events (
  id uuid primary key default gen_random_uuid(),
  email_id uuid not null references public.crm_emails(id) on delete restrict,
  estimate_id uuid not null references public.estimates(id) on delete restrict,
  event text not null check (event in ('opened', 'viewed', 'signed')),
  created_at timestamptz not null default now(),
  ip text,
  user_agent text,
  signer_name text,
  signer_email text,
  agreed boolean,
  signed_html text,
  signed_sha256 text
);
create index if not exists crm_email_events_email_idx on public.crm_email_events (email_id, created_at);
create index if not exists crm_email_events_estimate_idx on public.crm_email_events (estimate_id, created_at);

create or replace function public.crm_reject_history_change()
returns trigger language plpgsql as $$
begin
  raise exception 'Email history is append-only (% on % is not allowed)', TG_OP, TG_TABLE_NAME;
end;
$$;
drop trigger if exists crm_emails_append_only on public.crm_emails;
create trigger crm_emails_append_only before update or delete on public.crm_emails
  for each row execute function public.crm_reject_history_change();
drop trigger if exists crm_email_events_append_only on public.crm_email_events;
create trigger crm_email_events_append_only before update or delete on public.crm_email_events
  for each row execute function public.crm_reject_history_change();
-- Truncate bypasses row triggers, so block it too.
drop trigger if exists crm_emails_no_truncate on public.crm_emails;
create trigger crm_emails_no_truncate before truncate on public.crm_emails
  for each statement execute function public.crm_reject_history_change();
drop trigger if exists crm_email_events_no_truncate on public.crm_email_events;
create trigger crm_email_events_no_truncate before truncate on public.crm_email_events
  for each statement execute function public.crm_reject_history_change();

alter table public.crm_emails enable row level security;
alter table public.crm_email_events enable row level security;
revoke all on public.crm_emails, public.crm_email_events from anon, authenticated;
-- Server code (service role) may only read and append.
revoke update, delete, truncate on public.crm_emails, public.crm_email_events from service_role;
grant select, insert on public.crm_emails, public.crm_email_events to service_role;

-- Price / deposit change history (timestamp + rep), written on every Save Charges that
-- changes the total or the deposit. Append-only like the email history.
create table if not exists public.estimate_price_history (
  id uuid primary key default gen_random_uuid(),
  estimate_id uuid not null references public.estimates(id) on delete restrict,
  created_at timestamptz not null default now(),
  changed_by uuid references auth.users(id),
  changed_by_name text,
  old_total numeric(12,2),
  new_total numeric(12,2),
  old_deposit numeric(12,2),
  new_deposit numeric(12,2)
);
create index if not exists estimate_price_history_idx on public.estimate_price_history (estimate_id, created_at desc);
drop trigger if exists estimate_price_history_append_only on public.estimate_price_history;
create trigger estimate_price_history_append_only before update or delete on public.estimate_price_history
  for each row execute function public.crm_reject_history_change();
alter table public.estimate_price_history enable row level security;
revoke all on public.estimate_price_history from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Banner notifications / events: one row per recipient (job owner + each active
-- admin/supervisor), written by server code. Signed-in users may read only their
-- own rows; Supabase Realtime (postgres_changes) respects this policy, so each
-- browser receives only its own events instantly.
-- ---------------------------------------------------------------------------
create table if not exists public.crm_notifications (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id uuid references auth.users(id) on delete cascade,
  estimate_id uuid references public.estimates(id) on delete cascade,
  kind text not null,
  message text not null,
  amount numeric(12,2),
  dismissed_at timestamptz
);
create index if not exists crm_notifications_user_idx on public.crm_notifications (user_id, dismissed_at, created_at);
alter table public.crm_notifications enable row level security;
revoke all on public.crm_notifications from anon, authenticated;
grant select on public.crm_notifications to authenticated;
drop policy if exists "users read own notifications" on public.crm_notifications;
create policy "users read own notifications" on public.crm_notifications for select to authenticated
  using (user_id = (select auth.uid()));

-- Realtime: publish notification rows (and estimates, so live counts update).
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table public.crm_notifications;
    exception when duplicate_object then null; end;
    begin
      alter publication supabase_realtime add table public.estimates;
    exception when duplicate_object then null; end;
  end if;
end $$;
