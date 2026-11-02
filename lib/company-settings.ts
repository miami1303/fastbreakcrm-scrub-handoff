import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { DEFAULT_COMPANY, companyFromRows, type CompanyInfo } from "@/lib/templates/company";

/**
 * Live company contact info from company_settings. Called at render and send time
 * (no caching) so an admin's edit shows on the next document. Falls back to the seed
 * defaults only if the table can't be read.
 */
export async function getCompanyInfo(): Promise<CompanyInfo> {
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin.from("company_settings").select("key, value");
    if (error) return DEFAULT_COMPANY;
    return companyFromRows(data);
  } catch {
    return DEFAULT_COMPANY;
  }
}
