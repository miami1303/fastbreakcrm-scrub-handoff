-- In-CRM Inbox for support@fastbreakcrm.test (your mail host IMAP). Server-only tables
-- (service role); RLS on with no policies so the browser keys can't read mail directly.
create table if not exists public.mail_messages (
  id uuid primary key default gen_random_uuid(),
  folder text not null default 'INBOX',
  uidvalidity bigint not null,
  uid bigint not null,
  message_id text,
  in_reply_to text,
  references_header text,
  from_name text,
  from_address text,
  to_text text,
  cc_text text,
  reply_to text,
  subject text,
  sent_at timestamptz,
  snippet text,
  text_body text,
  html_body text,
  attachments jsonb not null default '[]'::jsonb,
  estimate_id uuid references public.estimates(id) on delete set null,
  opened_at timestamptz,
  opened_by uuid,
  replied_at timestamptz,
  forwarded_at timestamptz,
  deleted_at timestamptz,
  deleted_by uuid,
  created_at timestamptz not null default now(),
  unique (folder, uidvalidity, uid)
);
create index if not exists mail_messages_list_idx on public.mail_messages (deleted_at, sent_at desc);
create index if not exists mail_messages_unread_idx on public.mail_messages (sent_at desc) where opened_at is null and deleted_at is null;
create index if not exists mail_messages_estimate_idx on public.mail_messages (estimate_id);
alter table public.mail_messages enable row level security;

create table if not exists public.mail_sync_state (
  folder text primary key,
  uidvalidity bigint,
  last_uid bigint not null default 0,
  synced_at timestamptz,
  locked_until timestamptz,
  last_error text,
  updated_at timestamptz not null default now()
);
alter table public.mail_sync_state enable row level security;
