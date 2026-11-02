import { redirect } from "next/navigation";
import { getStaff } from "@/lib/crm-server";
import CrmHeader from "@/app/components/CrmHeader";

// Maintenance is admin-only (supervisors and salesmen are sent back to the menu).
export const dynamic = "force-dynamic";

export default async function MaintenanceLayout({ children }: { children: React.ReactNode }) {
  const staff = await getStaff();
  if (!staff) redirect("/user-login");
  if (staff.role !== "admin") redirect("/user-menu?error=access");
  return <><CrmHeader />{children}</>;
}
