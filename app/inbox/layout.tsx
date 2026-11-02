import CrmBanners from "@/app/components/CrmBanners";
import CrmHeader from "@/app/components/CrmHeader";

export const dynamic = "force-dynamic";

export default function Layout({ children }: { children: React.ReactNode }) {
  return <><CrmHeader /><CrmBanners />{children}</>;
}
