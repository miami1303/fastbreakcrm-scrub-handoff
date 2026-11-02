-- Sequential job numbers for estimates

alter table public.estimates add column if not exists job_number text unique;

create sequence if not exists public.job_number_seq start 40001;

create or replace function public.assign_job_number()
returns trigger language plpgsql as $$
begin
  if new.job_number is null then
    new.job_number := 'FB' || nextval('public.job_number_seq');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_assign_job_number on public.estimates;
create trigger trg_assign_job_number
  before insert on public.estimates
  for each row execute function public.assign_job_number();
