-- Assign New Estimates audit (Owner, 2026-10-23): every assignment from the Web Leads /
-- Bought Leads portal writes an 'assigned' row to the append-only status log.
-- FLAG: NEW migration, not applied live. Until it is applied, the app writes the same audit
-- line as an Operations note on the lead instead (see assignLead in app/actions/leads.ts).
alter table public.estimate_status_log drop constraint if exists estimate_status_log_action_check;
alter table public.estimate_status_log add constraint estimate_status_log_action_check
  check (action in ('booked', 'release_book', 'cancelled', 'reopened', 'assigned'));
