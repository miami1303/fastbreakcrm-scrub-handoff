// Every customer email: each visible job number (FB#####) becomes a real link to the customer's
// job/order page (Owner 2026-10-31). Text inside existing <a>, <style>, <script> is left alone.
const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

export function linkJobNumbers(html: string, jobNumber: string | null | undefined, href: string | null | undefined): string {
  const job = String(jobNumber || "").trim();
  if (!html || !job || !href) return html;
  const re = new RegExp(`\\b${job.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi");
  const anchor = (m: string) => `<a href="${esc(href)}" data-job-link="1" style="color:#000080;text-decoration:underline;">${m}</a>`;
  let skip = 0;
  return html.split(/(<[^>]*>)/).map(part => {
    if (part.startsWith("<")) {
      const t = /^<\s*(\/?)\s*(a|style|script|title)\b/i.exec(part);
      if (t) skip = Math.max(0, skip + (t[1] ? -1 : 1));
      return part;
    }
    return skip ? part : part.replace(re, anchor);
  }).join("");
}
