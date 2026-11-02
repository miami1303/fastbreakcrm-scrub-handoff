-- Columns the New Estimate form and the CC authorization form already need.
-- New migration only; earlier migrations are unchanged.
--
-- estimates.pickup_zip / delivery_zip: the New Estimate form (app/estimates/new) inserts these,
-- but no earlier migration created them, so saving a new estimate failed.
-- quotes.card_type / billing_zip: shown on the Credit Card Authorization Form
-- (Card Type checkbox and "Cardholder ZIP Code (from credit card billing address)").
-- Card data stays limited to cardholder name, card type, last 4, expiry, and billing ZIP.
-- Full card numbers and CVV are never stored.

alter table public.estimates
  add column if not exists pickup_zip text,
  add column if not exists delivery_zip text;

alter table public.quotes
  add column if not exists card_type text,
  add column if not exists billing_zip text;

-- saveQuote upserts with onConflict: "estimate_id", which requires a unique constraint.
create unique index if not exists quotes_estimate_id_key on public.quotes (estimate_id);
