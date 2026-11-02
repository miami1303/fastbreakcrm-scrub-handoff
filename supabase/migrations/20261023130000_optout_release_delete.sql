-- Opt-out / unsubscribe suppression list, Release Book log, and the single permanent-delete path.

-- ---------------------------------------------------------------------------
-- 1. Suppression list. One active block per email address (case-insensitive).
-- ---------------------------------------------------------------------------
create sequence if not exists public.crm_block_id_seq start with 100001;
create table if not exists public.crm_suppressions (
  id uuid primary key default gen_random_uuid(),
  block_id bigint not null unique default nextval('public.crm_block_id_seq'),
  email text not null,
  created_at timestamptz not null default now(),
  ip text,
  user_agent text,
  source_email_id uuid references public.crm_emails(id) on delete set null,
  removed_at timestamptz,
  removed_by uuid references auth.users(id),
  removed_by_name text
);
create unique index if not exists crm_suppressions_active_email
  on public.crm_suppressions (lower(email)) where removed_at is null;
alter table public.crm_suppressions enable row level security;
revoke all on public.crm_suppressions from anon, authenticated;
grant select, insert, update on public.crm_suppressions to service_role;
grant usage on sequence public.crm_block_id_seq to service_role;

-- Email history events gain opt-out entries (still append-only).
alter table public.crm_email_events drop constraint if exists crm_email_events_event_check;
alter table public.crm_email_events add constraint crm_email_events_event_check
  check (event in ('opened', 'viewed', 'signed', 'unsubscribed', 'block_removed'));
alter table public.crm_email_events add column if not exists block_id bigint;
alter table public.crm_email_events add column if not exists actor_name text;

-- ---------------------------------------------------------------------------
-- 2. Job status log (Book / Release Book / Cancel / Reopen): who and when. Append-only.
-- ---------------------------------------------------------------------------
create table if not exists public.estimate_status_log (
  id uuid primary key default gen_random_uuid(),
  estimate_id uuid not null references public.estimates(id) on delete restrict,
  action text not null check (action in ('booked', 'release_book', 'cancelled', 'reopened')),
  from_status text,
  to_status text,
  created_at timestamptz not null default now(),
  actor uuid references auth.users(id),
  actor_name text
);
create index if not exists estimate_status_log_idx on public.estimate_status_log (estimate_id, created_at desc);
drop trigger if exists estimate_status_log_append_only on public.estimate_status_log;
create trigger estimate_status_log_append_only before update or delete on public.estimate_status_log
  for each row execute function public.crm_reject_history_change();
alter table public.estimate_status_log enable row level security;
revoke all on public.estimate_status_log from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Permanent delete. History tables are append-only (their triggers reject DELETE).
--    crm_delete_lead() is the ONLY path that can remove them: it sets a transaction-local
--    flag the trigger honours, checks the actor is an active admin and that the typed job
--    number matches, deletes the lead and all of its rows, and writes a minimal audit row
--    (job number, who, when; no customer data).
-- ---------------------------------------------------------------------------
create table if not exists public.crm_deleted_jobs (
  id uuid primary key default gen_random_uuid(),
  job_number text,
  deleted_by uuid references auth.users(id),
  deleted_by_name text,
  deleted_at timestamptz not null default now()
);
drop trigger if exists crm_deleted_jobs_append_only on public.crm_deleted_jobs;
create trigger crm_deleted_jobs_append_only before update or delete on public.crm_deleted_jobs
  for each row execute function public.crm_reject_history_change();
alter table public.crm_deleted_jobs enable row level security;
revoke all on public.crm_deleted_jobs from anon, authenticated;
grant select on public.crm_deleted_jobs to service_role;

create or replace function public.crm_reject_history_change()
returns trigger language plpgsql as $$
begin
  if current_setting('crm.purge_lead', true) = 'on' then
    return case when TG_OP = 'DELETE' then OLD else NEW end;
  end if;
  raise exception 'Email history is append-only (% on % is not allowed)', TG_OP, TG_TABLE_NAME;
end;
$$;

create or replace function public.crm_delete_lead(p_estimate_id uuid, p_actor uuid, p_confirm_job_number text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_job text;
  v_name text;
begin
  select p.display_name into v_name from public.user_profiles p
    where p.user_id = p_actor and p.is_active and p.role = 'admin';
  if not found then raise exception 'Only an active admin can delete a lead.'; end if;

  select e.job_number into v_job from public.estimates e where e.id = p_estimate_id for update;
  if not found then raise exception 'Lead not found.'; end if;
  if coalesce(v_job, '') = '' or upper(trim(p_confirm_job_number)) <> upper(v_job) then
    raise exception 'Type the job number exactly to confirm.';
  end if;

  perform set_config('crm.purge_lead', 'on', true);  -- transaction-local
  delete from public.crm_email_events where estimate_id = p_estimate_id;
  delete from public.crm_emails where estimate_id = p_estimate_id;
  delete from public.estimate_price_history where estimate_id = p_estimate_id;
  delete from public.estimate_status_log where estimate_id = p_estimate_id;
  delete from public.card_access_log where estimate_id = p_estimate_id;
  delete from public.payments where estimate_id = p_estimate_id;
  delete from public.crm_notifications where estimate_id = p_estimate_id;
  delete from public.estimate_notes where estimate_id = p_estimate_id;
  delete from public.estimates where id = p_estimate_id;  -- vehicles / quotes cascade
  perform set_config('crm.purge_lead', 'off', true);

  insert into public.crm_deleted_jobs (job_number, deleted_by, deleted_by_name) values (v_job, p_actor, v_name);
  return v_job;
end;
$$;
revoke all on function public.crm_delete_lead(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.crm_delete_lead(uuid, uuid, text) to service_role;
