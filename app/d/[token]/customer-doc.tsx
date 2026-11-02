import { loadCustomerDocument } from "@/lib/customer-docs";
import { getCompanyInfo } from "@/lib/company-settings";
import PrintFit from "./print-fit";
import SignRow from "./sign-row";

/**
 * Customer-facing document (quote / booked order / CC form). Links look like
 * /d/FB400001/<unguessable token>: the job number is shown, the token is the security.
 * When a job number is in the URL it must match the token's job, or the link is invalid.
 */
export default async function CustomerDoc({ token, job }: { token: string; job?: string }) {
  let doc: Awaited<ReturnType<typeof loadCustomerDocument>> = null;
  try {
    doc = await loadCustomerDocument(token, job);
  } catch {
    doc = null;
  }
  if (!doc) {
    const c = await getCompanyInfo();
    return <main className="doc-page"><div className="doc-sheet" data-testid="invalid-link" style={{ padding: 40, fontFamily: "Arial, sans-serif" }}>This link is not valid. Please contact {c.quoteCompanyName} at {c.mainPhone}.</div></main>;
  }
  const signable = doc.kind === "booked_esign" || doc.kind === "cc_form";
  return (
    <main className="doc-page" data-testid="customer-doc" data-kind={doc.kind} data-job={doc.jobNumber || ""}>
      {signable && doc.signedAt && <div className="esign-done" data-testid="esign-done">Signed electronically {new Date(doc.signedAt).toLocaleString()}. Thank you!</div>}
      {signable && !doc.signedAt && <SignRow token={token} />}
      {doc.kind === "carrier_confirm" && <div className="carrier-confirm-bar" data-testid="carrier-confirm-bar">Carrier confirmed · Job {doc.jobNumber}</div>}
      <PrintFit />
      {doc.signedHtml
        ? <iframe title="Signed document" srcDoc={doc.signedHtml} className="doc-sheet" style={{ display: "block", width: "100%", maxWidth: 720, height: 1500, border: 0 }} />
        : <div className="doc-sheet" style={{ padding: "8px 0" }} dangerouslySetInnerHTML={{ __html: doc.bodyHtml }} />}
    </main>
  );
}
