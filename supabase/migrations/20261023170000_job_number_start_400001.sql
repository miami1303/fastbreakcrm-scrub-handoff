-- Job numbers: FB + six digits, first job FB400001 (confirmed by Owner 2026-10-23).
--
-- JOB_NUMBER_START is the ONE value to change if the start ever moves again: copy this
-- migration with a new timestamp and change the number below. Old migrations are not edited.
--
-- Format stays 'FB' || nextval (public.assign_job_number from 20261023050000). The sequence
-- is bigint and job_number is text, so it simply grows past 999999 (FB1000000, ...).
-- The sequence never moves backwards: if a job number at or above the start already exists,
-- numbering continues after the highest one, so nothing can collide with the unique index.
do $$
declare
  job_number_start constant bigint := 400001;
  v_max bigint;
begin
  select max(substring(job_number from 3)::bigint) into v_max
    from public.estimates where job_number ~ '^FB[0-9]+$';
  alter sequence public.job_number_seq no maxvalue no cycle;
  if v_max is null or v_max < job_number_start then
    perform setval('public.job_number_seq', job_number_start, false);  -- next nextval() = start
  else
    perform setval('public.job_number_seq', v_max, true);              -- next = highest + 1
  end if;
end;
$$;
