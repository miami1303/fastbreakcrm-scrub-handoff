-- TEST ONLY seed users (local passwords only, not real accounts).
create extension if not exists pgcrypto;
insert into auth.users (id, email, encrypted_password) values
  ('00000000-0000-4000-8000-000000000001', 'owner@example.test', crypt('Test-Only-1', gen_salt('bf'))),
  ('00000000-0000-4000-8000-000000000002', 'rep@example.test',  crypt('Test-Only-2', gen_salt('bf'))),
  ('00000000-0000-4000-8000-000000000003', 'jordan@example.test', crypt('Test-Only-3', gen_salt('bf'))),
  ('00000000-0000-4000-8000-000000000004', 'riley@example.test', crypt('Test-Only-4', gen_salt('bf')));
-- Sam and Jordan are admins with full access, like the live CRM (cards + Assign pool).
-- 'Riley' is a TEST-ONLY salesperson that keeps the rep-limited role (Salesperson Menu,
-- own leads only, masked cards) covered for future reps; there is no such live user.
insert into public.user_profiles (user_id, display_name, role, is_active, can_view_cards, can_claim_unassigned) values
  ('00000000-0000-4000-8000-000000000001', 'Owner', 'admin', true, false, false),
  ('00000000-0000-4000-8000-000000000002', 'Sam Rep', 'admin', true, true, true),
  ('00000000-0000-4000-8000-000000000003', 'Jordan Demo', 'admin', true, true, true),
  ('00000000-0000-4000-8000-000000000004', 'Riley Test', 'salesperson', true, false, false);
insert into public.user_identities (user_id, username) values
  ('00000000-0000-4000-8000-000000000001', 'owner'),
  ('00000000-0000-4000-8000-000000000002', 'Sam'),
  ('00000000-0000-4000-8000-000000000003', 'Jordan'),
  ('00000000-0000-4000-8000-000000000004', 'Riley');
insert into public.crm_reps (name, email, sort_order, in_rotation) values ('Riley Test', 'riley@example.test', 30, false) on conflict (name) do nothing;
-- Same auto-link the migration does, now that profiles exist.
update public.crm_reps r set user_id = p.user_id from public.user_profiles p
  where r.user_id is null and lower(p.display_name) = lower(r.name);

-- Fake-realtime feed (TEST ONLY): NOTIFY on rows of published tables.
create or replace function public._test_realtime_notify() returns trigger language plpgsql as $$
begin
  perform pg_notify('realtime', json_build_object('table', TG_TABLE_NAME, 'type', TG_OP,
    'record', row_to_json(NEW), 'commit_timestamp', now())::text);
  return NEW;
end $$;
create trigger _test_rt after insert or update on public.crm_notifications for each row execute function public._test_realtime_notify();
create trigger _test_rt after insert or update on public.estimates for each row execute function public._test_realtime_notify();
