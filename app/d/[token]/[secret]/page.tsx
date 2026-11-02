import type { Metadata } from "next";
import CustomerDoc from "../customer-doc";
import { JOB_NUMBER_RE } from "@/lib/job-number";

// /d/<JOB NUMBER>/<token>, e.g. /d/FB400001/Xy3...: job number shown, token required.
export const dynamic = "force-dynamic";

type P = { params: Promise<{ token: string; secret: string }> };

export async function generateMetadata({ params }: P): Promise<Metadata> {
  const { token: job } = await params;
  const safe = JOB_NUMBER_RE.test(job.toUpperCase()) ? job.toUpperCase() : "";
  return { title: `${safe ? `${safe} · ` : ""}Fastbreak CRM`, robots: { index: false, follow: false } };
}

export default async function JobDocumentPage({ params }: P) {
  const { token: job, secret } = await params;
  return <CustomerDoc token={secret} job={job} />;
}
