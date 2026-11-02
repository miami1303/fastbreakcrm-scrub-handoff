-- Add username-based authentication support
-- Maps usernames to Supabase Auth identities securely

create table if not exists public.user_identities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  username text not null unique,
  created_at timestamptz not null default now()
);

create index if not exists user_identities_username_idx on public.user_identities (username);

alter table public.user_identities enable row level security;

-- Allow authenticated users to read their own identity record
drop policy if exists "Users can read their own identity" on public.user_identities;
create policy "Users can read their own identity"
  on public.user_identities for select to authenticated
  using (user_id = (select auth.uid()));

-- Allow service role to read for auth lookups
drop policy if exists "Service role can read all identities" on public.user_identities;
create policy "Service role can read all identities"
  on public.user_identities for select to service_role
  using (true);
