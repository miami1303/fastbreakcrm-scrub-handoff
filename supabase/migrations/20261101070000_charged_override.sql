-- Charged pill manual on/off (Owner 2026-10-31). null = automatic from payments; true/false = manual.
alter table public.estimates add column if not exists charged_override boolean;
