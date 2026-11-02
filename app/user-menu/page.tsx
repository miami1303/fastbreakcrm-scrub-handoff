import { redirect } from "next/navigation";
import Link from "next/link";
import { signOut } from "@/app/actions/auth";
import CrmBanners from "@/app/components/CrmBanners";
import BrandLogo from "@/app/components/BrandLogo";
import { getCompanyInfo } from "@/lib/company-settings";
import { followUpTotalCount } from "@/app/actions/lists";
import { createSupabaseServerClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// MAIN MENU hub: "Admin Menu" for admins, "Salesperson Menu" for reps. Header, a search box
// (opens the Search page), and the two-column link list. Every item opens its own page with
// an Exit back here; nothing (lists, panels, results) is embedded on the menu itself.
export default async function UserMenuPage() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/user-login");

  const { data: profile, error: profileError } = await supabase
    .from("user_profiles")
    .select("display_name, role, is_active, can_claim_unassigned")
    .eq("user_id", user.id)
    .maybeSingle();

  if (profileError || !profile?.is_active) redirect("/user-login?error=access");
  // Admins and supervisors may open the user menu too (the Admin Menu links here).
  if (!["salesperson", "admin", "supervisor"].includes(profile.role)) redirect("/user-login?error=access");
  const manager = profile.role === "admin" || profile.role === "supervisor";
  const menuTitle = profile.role === "admin" ? "Admin Menu" : profile.role === "supervisor" ? "Supervisor Menu" : "Salesperson Menu";

  // Follow-Up Menu (N): the TOTAL number of jobs in this user's Follow-Up Menu (same query as
  // the menu itself: own open leads + leads assigned to their rep row; service-role, so RLS can't zero it).
  const [{ data: identity }, company, followCount] = await Promise.all([
    supabase.from("user_identities").select("username").eq("user_id", user.id).maybeSingle(),
    getCompanyInfo(),
    followUpTotalCount(),
  ]);
  const today = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "America/Chicago" });
  const name = profile.display_name || user.email || "";
  const username = (identity?.username || user.email?.split("@")[0] || "").toUpperCase();

  return (
    <>
      <CrmBanners />
      <main className="app-shell menu-shell">
        <section className="menu-card hub" data-testid="menu-card">
          <header className="hub-header">
            <div className="hub-brand">
              <BrandLogo height={56} />
              <div className="hub-contact"><span data-testid="hub-phone">{company.mainPhone}</span><span data-testid="hub-email">{company.companyEmail}</span></div>
            </div>
            <div className="hub-user">
              <span>Welcome <b data-testid="hub-welcome">{name}</b></span>
              <span className="muted">Logged in as <b data-testid="hub-username">{username}</b></span>
              <span className="muted" data-testid="hub-date">{today}</span>
              <form action={signOut}><button className="text-button" type="submit" data-testid="log-out">Log Out</button></form>
            </div>
          </header>

          <h1 className="hub-title" data-testid="hub-title">{menuTitle}</h1>
          <form className="search-bar" action="/search" method="get" target="_blank" data-newtab data-testid="menu-search-form">
            <input name="q" placeholder="Search name, phone, email, or job #" aria-label="Search" data-testid="menu-search" />
            <button type="submit" className="btn btn-primary" data-testid="menu-search-btn">Search</button>
          </form>

          <nav className="hub-grid" aria-label="Main menu" data-testid="menu-grid">
            <div className="hub-col">
              <Link className="hub-link" target="_blank" rel="noopener" data-newtab href="/estimates/new" data-testid="menu-new-estimate">New Estimate</Link>
              <Link className="hub-link" target="_blank" rel="noopener" data-newtab href="/estimates" data-testid="menu-estimates">Estimates in Process</Link>
              <Link className="hub-link" target="_blank" rel="noopener" data-newtab href="/recurring" data-testid="menu-recurring">Recurring Customers</Link>
              <Link className="hub-link" target="_blank" rel="noopener" data-newtab href="/operations" data-testid="menu-operations">Operations Calendar</Link>
              {profile.role === "admin" && <Link className="hub-link admin" target="_blank" rel="noopener" data-newtab href="/estimates/assign" data-testid="menu-assign">Assign New Estimates</Link>}
            </div>
            <div className="hub-col">
              {manager && <Link className="hub-link admin" target="_blank" rel="noopener" data-newtab href="/inbox" data-testid="menu-inbox">Email Inbox (info@)</Link>}
              {manager && <Link className="hub-link admin" target="_blank" rel="noopener" data-newtab href="/performance" data-testid="menu-performance">Salesmen Performance</Link>}
              <Link className="hub-link" target="_blank" rel="noopener" data-newtab href="/reports" data-testid="menu-reports">Reports</Link>
              <Link className="hub-link" target="_blank" rel="noopener" data-newtab href="/follow-up" data-testid="menu-follow-up">Follow-Up Menu <span className="hub-count" data-testid="menu-follow-count">({followCount})</span></Link>
              <Link className="hub-link" target="_blank" rel="noopener" data-newtab href="/recent" data-testid="menu-recent">Recent Accessed Jobs</Link>
              {profile.role === "admin" && <Link className="hub-link admin" target="_blank" rel="noopener" data-newtab href="/admin-menu/maintenance" data-testid="menu-maintenance">Maintenance</Link>}
            </div>
          </nav>
        </section>
      </main>
    </>
  );
}
