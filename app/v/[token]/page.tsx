import type { Metadata } from "next";
import Image from "next/image";
import { BRAND, LOGO_PATH } from "@/lib/brand";
import { isQuoteMessageKind } from "@/lib/crm-constants";
import { getCompanyInfo } from "@/lib/company-settings";
import { fillMerge, isEmailToken, isPickupConfirm, QUOTE_PAGE_BUTTON, CARRIER_PAGE_BUTTON } from "@/lib/customer-email-views";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { websiteHref, websiteLabel } from "@/lib/templates/company";

// Landing page for quote letters and pickup confirmed. Loading it does not count as a view. The button is a real
// form post, so a link scanner that only fetches the page is not a viewed event.
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Your quote", robots: { index: false, follow: false } };

export default async function QuoteLandingPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const company = await getCompanyInfo();
  let job = "";
  let isCarrier = false;
  if (isEmailToken(token)) {
    try {
      const admin = createSupabaseAdminClient();
      const { data: email } = await admin.from("crm_emails").select("estimate_id, kind").eq("token", token).maybeSingle();
      if (email && (isQuoteMessageKind(email.kind) || isPickupConfirm(email.kind))) {
        isCarrier = isPickupConfirm(email.kind);
        const { data: est } = await admin.from("estimates").select("job_number").eq("id", email.estimate_id).maybeSingle();
        job = String(est?.job_number || "").trim();
      }
    } catch {
      job = "";
    }
  }
  const buttonTemplate = isCarrier ? CARRIER_PAGE_BUTTON : QUOTE_PAGE_BUTTON;
  const button = job ? fillMerge(buttonTemplate, { job_number: job }) : "";
  return (
    <main style={{ minHeight: "100vh", margin: 0, background: "#eef1f4", color: BRAND.ink, fontFamily: "Arial, Helvetica, sans-serif" }}>
      <header style={{ background: "#ffffff", borderTop: `4px solid ${BRAND.blue}`, borderBottom: `3px solid ${BRAND.red}`, padding: "clamp(16px, 4vw, 28px) 16px clamp(14px, 3vw, 22px)", textAlign: "center" }}>
        <Image src={LOGO_PATH} alt={company.quoteCompanyName} width={200} height={107} priority style={{ width: "min(200px, 60vw)", height: "auto" }} />
        <div style={{ marginTop: 12, fontSize: 22, fontWeight: 700, color: BRAND.blue }}>{company.quoteCompanyName}</div>
        <div style={{ marginTop: 4, fontSize: 18, fontWeight: 600, color: BRAND.ink }}>{company.mainPhone}</div>
        <a href={websiteHref(company.website)} style={{ color: BRAND.blue, fontSize: 15, textDecoration: "underline" }}>{websiteLabel(company.website)}</a>
      </header>
      <section style={{ maxWidth: 560, margin: "clamp(24px, 6vw, 48px) auto", padding: "0 16px", textAlign: "center" }}>
        {button ? (
          <form method="post" action={`/v/${encodeURIComponent(token)}/open`}>
            <button type="submit" data-testid="quote-landing-button" style={{ display: "inline-block", width: "100%", maxWidth: 460, background: BRAND.red, color: "#ffffff", fontSize: "clamp(17px, 4.5vw, 22px)", fontWeight: 700, lineHeight: 1.35, padding: "clamp(16px, 4vw, 22px) 20px", border: 0, borderRadius: 8, boxShadow: "0 2px 6px rgba(23,32,51,.18)", cursor: "pointer" }}>
              {button}
            </button>
          </form>
        ) : (
          <p data-testid="quote-landing-invalid" style={{ background: "#ffffff", border: "1px solid #e2e8ee", borderRadius: 10, padding: "28px 22px", fontSize: 16, lineHeight: 1.5 }}>
            This link is not valid. Please call {company.quoteCompanyName} at {company.mainPhone}.
          </p>
        )}
      </section>
    </main>
  );
}
