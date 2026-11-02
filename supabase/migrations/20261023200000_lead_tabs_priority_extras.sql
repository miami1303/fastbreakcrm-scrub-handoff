-- NEW (after the 16 core-flow migrations): priorities 0-8, pickup time, extra charge lines,
-- vehicle color / engine / qty / price.
-- Additive and idempotent. The app hides each feature until its column exists.
-- 1) Priorities 0-8 (was 0-4). Existing values are untouched.
-- 2) estimates.pickup_time: the expected pickup time ("HH:MM", America/Chicago wall clock)
--    entered next to the Primary / Backup pickup dates. The app hides the field until this exists.
alter table public.estimates drop constraint if exists estimates_priority_range;
alter table public.estimates add constraint estimates_priority_range check (priority between 0 and 8);

alter table public.estimates add column if not exists pickup_time text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'estimates_pickup_time_format') then
    alter table public.estimates add constraint estimates_pickup_time_format
      check (pickup_time is null or pickup_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
  end if;
end $$;

-- Priority labels 5-8 (keeps any names already saved for 0-4).
update public.crm_settings
   set value = value || '["Priority 5","Priority 6","Priority 7","Priority 8"]'::jsonb
 where key = 'priority_labels' and jsonb_typeof(value) = 'array' and jsonb_array_length(value) = 5;

-- 3) Up to 3 optional extra charge lines on the quote: [{"description": "...", "amount": 75.00}].
--    They add to the Total and print on the customer quote / booked order only when filled.
alter table public.quotes add column if not exists extra_charges jsonb not null default '[]'::jsonb;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'quotes_extra_charges_shape') then
    alter table public.quotes add constraint quotes_extra_charges_shape
      check (jsonb_typeof(extra_charges) = 'array' and jsonb_array_length(extra_charges) <= 3);
  end if;
end $$;

-- 4) The append-only charges history also logs vehicle edits and extra charge lines.
do $$
declare c text;
begin
  for c in select conname from pg_constraint
            where conrelid = 'public.estimate_extra_notes_history'::regclass and contype = 'c'
              and pg_get_constraintdef(oid) ilike '%field%' and conname <> 'estimate_extra_notes_history_field_values'
  loop
    execute format('alter table public.estimate_extra_notes_history drop constraint %I', c);
  end loop;
  if not exists (select 1 from pg_constraint where conname = 'estimate_extra_notes_history_field_values') then
    alter table public.estimate_extra_notes_history add constraint estimate_extra_notes_history_field_values
      check (field in ('extra_stop', 'remarks', 'vehicles', 'extra_charges'));
  end if;
end $$;

-- 5) Add/Update Vehicle screen: color, engine, quantity and an optional price per vehicle.
--    price null = not priced yet (counts as $0; the rep is warned before sending a quote).
alter table public.vehicles add column if not exists color text check (color is null or length(color) <= 40);
alter table public.vehicles add column if not exists engine text check (engine is null or engine in ('Gas', 'Diesel', 'Hybrid', 'Electric'));
alter table public.vehicles add column if not exists qty integer not null default 1 check (qty between 1 and 99);
alter table public.vehicles add column if not exists price numeric(12,2) check (price is null or price >= 0);
