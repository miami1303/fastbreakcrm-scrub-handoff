// Server-side allow-list sanitizer for rep-written rich text (Free Text Email body and
// Extra Stop / Notes). Output is email-safe HTML: inline styles only, no scripts/handlers.
// Links: http, https and mailto only; always open in a new tab with rel=noopener; the
// customer sees the link NAME (blue, underlined), never a raw URL we add.
import sanitizeHtml from "sanitize-html";

const SIZE = /^(\d{1,2}(px|pt)|x-small|small|medium|large|x-large|xx-large)$/;
const COLOR = /^(#[0-9a-f]{3,8}|rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\))$/i;

export function sanitizeRichHtml(html: string | null | undefined, opts: { images?: boolean } = {}): string {
  const tags = ["p", "div", "br", "b", "strong", "i", "em", "u", "span", "font", "a", "ul", "ol", "li", "blockquote", "h1", "h2", "h3", "hr", "table", "thead", "tbody", "tr", "td", "th"];
  if (opts.images) tags.push("img");
  const blockStyle = ["style"];
  return sanitizeHtml(String(html || "").slice(0, 100_000), {
    allowedTags: tags,
    allowedAttributes: {
      a: ["href", "target", "rel", "style"], img: ["src", "alt", "width", "height", "style"], font: ["size", "color"],
      span: blockStyle, p: blockStyle, div: blockStyle, li: blockStyle, h1: blockStyle, h2: blockStyle, h3: blockStyle, blockquote: blockStyle,
      table: ["style", "border", "cellpadding", "cellspacing", "width"], td: ["style", "colspan", "rowspan"], th: ["style", "colspan", "rowspan"],
    },
    allowedStyles: {
      "*": {
        "font-size": [SIZE], color: [COLOR], "background-color": [COLOR],
        "font-weight": [/^(bold|normal|[1-9]00)$/], "font-style": [/^(italic|normal)$/], "text-decoration": [/^(underline|none|line-through)$/],
        "text-align": [/^(left|right|center|justify)$/], margin: [/^(\d{1,2}(px)? ?){1,4}$/], "margin-left": [/^\d{1,3}px$/], "padding-left": [/^\d{1,3}px$/],
        border: [/^1px solid (#[0-9a-f]{3,6}|black|#000)$/i], "border-collapse": [/^collapse$/], width: [/^\d{1,3}%$/], padding: [/^\d{1,2}px$/],
        "max-width": [/^100%$/], height: [/^auto$/],
      },
    },
    allowedSchemes: ["http", "https", "mailto"],
    allowedSchemesByTag: { img: ["https"] },
    allowProtocolRelative: false,
    transformTags: {
      // Disallowed or missing URL -> plain text (the name stays, the link goes).
      a: (_t, a) => /^(https?:\/\/|mailto:)/i.test((a.href || "").trim())
        ? { tagName: "a", attribs: { href: a.href.trim(), target: "_blank", rel: "noopener noreferrer", style: "color:#1a4fb4;text-decoration:underline;" } }
        : { tagName: "span", attribs: {} as Record<string, string> },
      img: (_t, a) => ({ tagName: "img", attribs: { ...a, style: "max-width:100%;height:auto;border:0;" } }),
      // Email clients give <p> big default margins; keep rep content compact (one-page documents).
      p: (_t, a) => ({ tagName: "p", attribs: { ...a, style: `margin:0 0 3px 0;${a.style || ""}` } }),
      table: (_t, a) => ({ tagName: "table", attribs: { ...a, cellpadding: "4", cellspacing: "0", style: "border-collapse:collapse;" } }),
      td: (_t, a) => ({ tagName: "td", attribs: { ...a, style: `border:1px solid #000;${a.style || ""}` } }),
    },
  }).trim();
}

/** True when the sanitized HTML has no visible content. */
export const isBlankHtml = (html: string) => !/<(img|hr|table)/i.test(html) && !html.replace(/<[^>]*>|&nbsp;|\s/g, "");

export function htmlToText(html: string): string {
  return sanitizeHtml(html.replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|li|h\d|tr)>/gi, "\n"), { allowedTags: [], allowedAttributes: {} })
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/\n{3,}/g, "\n\n").trim();
}
