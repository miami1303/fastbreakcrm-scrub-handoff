// Client-safe list of letter merge fields (filled by letterFields in customer-messages.ts).
/** Merge fields shown as chips in the editor. Filled from the lead + assigned rep + Company Settings. */
export const MERGE_FIELDS: { key: string; label: string }[] = [
  { key: "customer_name", label: "Customer name" },
  { key: "job_number", label: "Job # (FB#####)" },
  { key: "pickup_city_state_zip", label: "Pickup city, ST ZIP" },
  { key: "delivery_city_state_zip", label: "Delivery city, ST ZIP" },
  { key: "delivery_state", label: "Delivery state" },
  { key: "pickup_date", label: "Pickup date" },
  { key: "reservation_link", label: "Reservation / quote link" },
  { key: "rep_name", label: "Rep name" },
  { key: "rep_title", label: "Rep title" },
  { key: "rep_direct_line", label: "Rep direct line" },
  { key: "office_phone", label: "Office phone" },
  { key: "company_name", label: "Company name" },
  { key: "company_email", label: "Company email" },
  { key: "website", label: "Website" },
  { key: "us_dot", label: "US DOT" },
  { key: "mc", label: "MC" },
];
export const MERGE_FIELD_KEYS = MERGE_FIELDS.map(f => f.key);

