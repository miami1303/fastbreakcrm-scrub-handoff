import { redirect } from "next/navigation";

// Team Management moved: Maintenance → Users is the single place to invite, add, edit, disable and delete users.
export default function TeamManagementPage() {
  redirect("/admin-menu/maintenance?tab=users");
}
