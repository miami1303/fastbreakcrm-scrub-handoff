import { createSupabaseAdminClient } from "./supabase-admin";
import { priorityLabelsFrom, type PriorityLabel } from "./follow-up-domain";

const MISSING = /priority_labels|schema cache|does not exist|42P01|PGRST205/i;

/** Company's labels. An empty list (or a database that does not have the table yet) means none. */
export async function loadPriorityLabels(): Promise<PriorityLabel[]> {
  return (await readPriorityLabelRows()).labels;
}

export async function readPriorityLabelRows(): Promise<{ labels: PriorityLabel[]; missing: boolean }> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.from("priority_labels").select("number, label").order("number");
  if (error) {
    if (MISSING.test(`${error.code || ""} ${error.message || ""}`)) return { labels: [], missing: true };
    throw new Error(error.message);
  }
  return { labels: priorityLabelsFrom(data), missing: false };
}
