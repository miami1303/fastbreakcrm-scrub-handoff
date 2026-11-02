-- Mirrors the live-only migration "restrict_crm_admin_helpers_to_authenticated"
-- (live version 20261009050814) so repo history lines up. Idempotent: safe to re-run.
-- EXECUTE on the admin helper functions is limited to signed-in users and the service role.
do $$
begin
  if to_regprocedure('public.crm_is_active_admin()') is not null then
    revoke all on function public.crm_is_active_admin() from public, anon;
    grant execute on function public.crm_is_active_admin() to authenticated, service_role;
  end if;
  if to_regprocedure('public.crm_is_active_admin_or_supervisor()') is not null then
    revoke all on function public.crm_is_active_admin_or_supervisor() from public, anon;
    grant execute on function public.crm_is_active_admin_or_supervisor() to authenticated, service_role;
  end if;
end;
$$;
