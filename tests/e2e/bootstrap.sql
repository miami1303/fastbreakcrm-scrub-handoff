-- TEST ONLY. Mimics the parts of a Supabase project the CRM relies on, so the real
-- migrations can run on a throwaway local Postgres. Never run this on Owner's Supabase.
create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;
create role authenticator login noinherit password 'local-test-only';
grant anon, authenticated, service_role to authenticator;

create schema auth;
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  encrypted_password text,
  raw_user_meta_data jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid $$;
create function auth.role() returns text language sql stable as
  $$ select current_setting('request.jwt.claims', true)::json->>'role' $$;
grant usage on schema auth to anon, authenticated, service_role;
grant select on auth.users to service_role;

grant usage on schema public to anon, authenticated, service_role;
-- Supabase's default: new public tables/sequences/functions are granted to these roles.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;

create publication supabase_realtime;
