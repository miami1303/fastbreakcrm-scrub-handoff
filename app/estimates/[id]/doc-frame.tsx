"use client";

import { useState } from "react";

/** Read-only customer document preview (no tracking: the preview HTML has no pixel or token). */
export default function DocFrame({ html, title, scrollTo, testId = "doc-frame" }: { html: string; title: string; scrollTo?: string; testId?: string }) {
  const [height, setHeight] = useState(900);
  return (
    <iframe title={title} srcDoc={html} data-testid={testId}
      style={{ width: "100%", height: scrollTo ? 560 : height, border: "1px solid var(--line)", background: "#fff", borderRadius: 8 }}
      onLoad={ev => {
        const d = ev.currentTarget.contentDocument;
        if (!d?.body) return;
        if (scrollTo) d.querySelector(scrollTo)?.scrollIntoView({ block: "start" });
        else setHeight(d.body.scrollHeight + 24);
      }} />
  );
}
