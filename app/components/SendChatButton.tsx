"use client";

import { useState } from "react";
import { sendCustomerMessage } from "@/app/actions/email";

/** Rep presses this. Nothing is emailed until they do, and not at all if mail is not configured. */
export function SendChatButton({ estimateId }: { estimateId: string }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  async function go() {
    setBusy(true);
    const r = await sendCustomerMessage(estimateId, "hi_lets_chat");
    setBusy(false);
    if (!r.ok) { setNote(r.error); return; }
    if (r.sent) { setNote(`Sent to ${r.to}`); return; }
    setNote("Logged. Your email program will open so you can send it.");
    const q = new URLSearchParams({ subject: r.subject, body: r.text });
    if (r.cc) q.set("cc", r.cc);
    window.location.href = `mailto:${encodeURIComponent(r.to)}?${q.toString().replace(/\+/g, "%20")}`;
  }
  return (
    <span data-newtab="">
      <button type="button" className="btn btn-sm" data-testid="send-hi-lets-chat" data-newtab="" disabled={busy} onClick={go}>
        {busy ? "Sending…" : "Send Hi, let's chat!"}
      </button>
      {note && <small className="muted" style={{ display: "block" }}>{note}</small>}
    </span>
  );
}
