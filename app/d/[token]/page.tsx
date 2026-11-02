import type { Metadata } from "next";
import CustomerDoc from "./customer-doc";

// Older links: /d/<token> (still valid). New links carry the job number: /d/FB400001/<token>.
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Fastbreak CRM", robots: { index: false, follow: false } };

export default async function CustomerDocumentPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <CustomerDoc token={token} />;
}
