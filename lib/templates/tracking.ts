// Every outgoing email gets tracking by default (Owner, 2026-10-23), applied in renderTemplate so
// a new template can't miss it:
//   - the per-send pixel (/api/email/open/<token>) is added if the template didn't place it
//   - every http(s) link (website, images links, rep links) goes through /api/email/click/<token>?u=
//     except the document link /d/<job>/<token> (already tracked), the quote landing
//     page /v/<token> (the button on that page is the view, not this click), the
//     opt-out link and the pixel.
import { escapeHtml } from "./layout.ts";

export type TrackingLinks = { trackingPixelUrl?: string | null; clickBase?: string | null; optOutHref?: string | null };

export const pixelImg = (url: string) =>
  `<img src="${escapeHtml(url)}" width="1" height="1" alt="" data-tracking-pixel="1" style="display:block;width:1px;height:1px;border:0;">`;

export function trackedHref(clickBase: string, url: string) {
  return `${clickBase}?u=${encodeURIComponent(url)}`;
}

export function applyTracking(html: string, l: TrackingLinks | null | undefined): string {
  if (!l) return html;
  let out = html;
  if (l.clickBase) {
    const base = l.clickBase;
    out = out.replace(/(<a\b[^>]*?\shref=")(https?:\/\/[^"]+)(")/gi, (m, pre: string, href: string, post: string) => {
      const raw = href.replace(/&amp;/g, "&");
      if (raw.startsWith(base) || /\/d\/[^/]+\/[^/?#]+/.test(raw) || /\/v\/[^/?#]+/.test(raw) || (l.optOutHref && raw === l.optOutHref) || /\/u\/[^/?#]+$/.test(raw)) return m;
      return `${pre}${escapeHtml(trackedHref(base, raw))}${post}`;
    });
  }
  if (l.trackingPixelUrl && !out.includes(escapeHtml(l.trackingPixelUrl))) out += pixelImg(l.trackingPixelUrl);
  return out;
}
