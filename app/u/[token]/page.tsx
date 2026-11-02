import type { Metadata } from "next";
import OptOut from "./opt-out";

// Customer "Opt out / Unsubscribe" page (link at the bottom of every customer email/document).
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Unsubscribe", robots: { index: false, follow: false } };

export default async function UnsubscribePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <main className="doc-page">
      <div className="doc-sheet" style={{ padding: "40px 32px", fontFamily: "Arial, Helvetica, sans-serif", textAlign: "center", maxWidth: 520 }}>
        <OptOut token={token} />
      </div>
    </main>
  );
}
