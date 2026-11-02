-- Card type on Payments: blank by default; the rep's pick ('rep') always wins; if blank and the
-- card number confidently matches a prefix+length rule, the detected type is stored ('auto').
alter table public.payments add column if not exists card_type_source text
  check (card_type_source is null or card_type_source in ('rep', 'auto'));
alter table public.quotes add column if not exists card_type_source text
  check (card_type_source is null or card_type_source in ('rep', 'auto'));
