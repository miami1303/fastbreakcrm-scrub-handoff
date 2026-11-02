-- Company Policy (terms) for quotes and booked jobs.
-- Admin-editable in Maintenance > Company Settings. Fast Break demo: generic sample text only.
insert into public.company_settings (key, value) values
  ('policy_quote', 'Sample terms for the Fastbreak CRM demo. Replace this text with your own company policy in Maintenance > Company Settings before sending documents to customers.'),
  ('policy_booked', 'Sample terms for the Fastbreak CRM demo. Replace this text with your own company policy in Maintenance > Company Settings before sending documents to customers. By signing, the customer agrees to the quoted price, deposit, and balance due shown above, and to the company''s own terms provided separately.')
on conflict (key) do update set value = excluded.value;
