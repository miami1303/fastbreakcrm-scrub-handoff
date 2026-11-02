-- Maintenance > Email Center: per-template e-sign option. 'order' = red link to the Auto Transport
-- Order for Service e-sign (booked_esign), 'cc' = the Credit Card Authorization Form (cc_form).
-- Additive only; existing templates stay 'none'.
alter table public.email_templates add column if not exists esign text not null default 'none';
alter table public.email_templates drop constraint if exists email_templates_esign_check;
alter table public.email_templates add constraint email_templates_esign_check check (esign in ('none', 'order', 'cc'));
