import Link from "next/link";
import BrandLogo from "@/app/components/BrandLogo";
import { AdminMenuButton } from "@/app/components/TabLinks";
import InboxBell from "@/app/components/InboxBell";
import { getCompanyInfo } from "@/lib/company-settings";

/** CRM top bar: logo on the left, call line on the right (same layout as the customer quote header). */
export default async function CrmHeader() {
  const company = await getCompanyInfo();
  return (
    <header className="crm-header">
      <Link href="/user-menu" aria-label="Main menu"><BrandLogo height={40} /></Link>
      <span className="crm-header-right">
        {/* Back to the menu in THIS tab (menu items open in their own tabs; this is the way back if it was closed). */}
        <InboxBell />
        <AdminMenuButton />
        <span className="crm-header-call">Call <b>{company.mainPhone}</b></span>
      </span>
    </header>
  );
}
