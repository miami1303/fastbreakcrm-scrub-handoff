import { redirect } from "next/navigation";

// Company Settings now lives under Admin > Maintenance.
export default function CompanySettingsRedirect() {
  redirect("/admin-menu/maintenance?tab=company");
}
