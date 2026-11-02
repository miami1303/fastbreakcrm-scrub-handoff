-- Email Center: Free Text emails, per-lead running sequence (#001, #002, ...), and an exact
-- HTML snapshot of every email as it was sent. crm_emails stays APPEND-ONLY (trigger from
-- 20261023090000 rejects UPDATE/DELETE/TRUNCATE).

alter table public.crm_emails drop constraint if exists crm_emails_kind_check;
alter table public.crm_emails add constraint crm_emails_kind_check
  check (kind in ('cc_form', 'e_quote', 'booked_esign', 'free_text'));

alter table public.crm_emails add column if not exists seq integer;
alter table public.crm_emails add column if not exists html_snapshot text;   -- exact HTML sent
alter table public.crm_emails add column if not exists sent_cc text;
alter table public.crm_emails add column if not exists sent_from text;

-- One-time backfill of seq for rows sent before this migration (the only time existing rows
-- are touched; the append-only trigger is re-enabled immediately).
alter table public.crm_emails disable trigger crm_emails_append_only;
update public.crm_emails e set seq = s.n
  from (select id, row_number() over (partition by estimate_id order by created_at, id) as n from public.crm_emails) s
  where s.id = e.id and e.seq is null;
alter table public.crm_emails enable trigger crm_emails_append_only;

-- New rows get the next number for their lead (serialized per lead with an advisory lock).
create or replace function public.crm_email_next_seq()
returns trigger language plpgsql as $$
begin
  perform pg_advisory_xact_lock(hashtext('crm_emails_seq:' || new.estimate_id::text));
  select coalesce(max(seq), 0) + 1 into new.seq from public.crm_emails where estimate_id = new.estimate_id;
  return new;
end;
$$;
drop trigger if exists crm_emails_seq on public.crm_emails;
create trigger crm_emails_seq before insert on public.crm_emails
  for each row execute function public.crm_email_next_seq();

create unique index if not exists crm_emails_estimate_seq_idx on public.crm_emails (estimate_id, seq);

-- EXTRA STOP / NOTES: rich text (sanitized HTML) printed in the middle of the customer
-- quote / booked order. Every save is kept (timestamp + rep), append-only.
alter table public.estimates add column if not exists extra_stop_html text;
create table if not exists public.estimate_extra_notes_history (
  id uuid primary key default gen_random_uuid(),
  estimate_id uuid not null references public.estimates(id) on delete cascade,
  html text not null,
  edited_by uuid references auth.users(id),
  edited_by_name text,
  created_at timestamptz not null default now()
);
create index if not exists estimate_extra_notes_history_idx on public.estimate_extra_notes_history (estimate_id, created_at desc);
drop trigger if exists estimate_extra_notes_history_append_only on public.estimate_extra_notes_history;
create trigger estimate_extra_notes_history_append_only before update or delete on public.estimate_extra_notes_history
  for each row execute function public.crm_reject_history_change();
alter table public.estimate_extra_notes_history enable row level security;
revoke all on public.estimate_extra_notes_history from anon, authenticated;
