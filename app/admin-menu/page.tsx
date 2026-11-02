import { redirect } from "next/navigation";

// The old Admin Menu (sidebar + legacy follow-up list) is retired: everyone uses the main
// menu hub. Admin pages (Maintenance, Lead Rotation, Team) are linked from the hub.
export default function AdminMenuPage() {
  redirect("/user-menu");
}
