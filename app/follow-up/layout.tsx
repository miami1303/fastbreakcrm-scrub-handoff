import CrmBanners from "@/app/components/CrmBanners";
import CrmHeader from "@/app/components/CrmHeader";

// Rendered on demand so `next build` succeeds without Supabase env vars (CI has no secrets).
export const dynamic = "force-dynamic";

export default function Layout({ children }: { children: React.ReactNode }) {
  return <><CrmHeader /><CrmBanners />{children}</>;
}
