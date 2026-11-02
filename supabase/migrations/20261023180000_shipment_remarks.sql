-- One shared "Remarks" box for the shipment (Owner, 2026-10-23). Typed on the rep's lead page
-- under Vehicles, saved by Submit Charges, printed as "Remarks" under Vehicles on the E-Quote
-- and the booked Auto Transport Order (hidden when empty). Per-vehicle remarks are unchanged.
alter table public.estimates add column if not exists shipment_remarks text
  check (shipment_remarks is null or length(shipment_remarks) <= 4000);

-- Changes are logged in the same append-only history as Extra Stop / Notes ("Charges change history").
alter table public.estimate_extra_notes_history add column if not exists field text not null default 'extra_stop'
  check (field in ('extra_stop', 'remarks'));
