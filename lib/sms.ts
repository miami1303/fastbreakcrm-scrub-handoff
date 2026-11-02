// Text messages (SMS). OFF until Owner supplies the API credentials; nothing is sent and nothing is
// spent until then. Plugging the provider in is one step: set the env vars in Vercel and redeploy.
//   Twilio (default):  SMS_PROVIDER=twilio  TWILIO_ACCOUNT_SID=AC...  TWILIO_AUTH_TOKEN=...
//                      TWILIO_FROM=+1XXXXXXXXXX   (or TWILIO_MESSAGING_SERVICE_SID=MG...)
// Another provider: add a branch in sendSms() below; the rest of the CRM only calls sendSms().
export type SmsMode = "twilio";
export type SmsResult = { ok: true; mode: SmsMode; id: string } | { ok: false; mode: SmsMode | null; error: string };

export function smsMode(env: NodeJS.ProcessEnv = process.env): SmsMode | null {
  const provider = (env.SMS_PROVIDER || "twilio").trim().toLowerCase();
  if (provider === "twilio" && env.TWILIO_ACCOUNT_SID?.trim() && env.TWILIO_AUTH_TOKEN?.trim() && (env.TWILIO_FROM?.trim() || env.TWILIO_MESSAGING_SERVICE_SID?.trim())) return "twilio";
  return null;
}

/** US numbers -> E.164 (+1XXXXXXXXXX). null when it is not a usable mobile number. */
export function toE164(phone: string | null | undefined): string | null {
  const d = String(phone || "").replace(/\D/g, "");
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith("1")) return `+${d}`;
  return null;
}

/** The payment-link text (kept short: one or two SMS segments). */
export function paymentLinkSms(o: { company: string; job: string; amount: string; url: string; phone: string; zelle?: string | null }): string {
  const z = o.zelle ? ` Or Zelle ${o.zelle} (memo ${o.job}).` : "";
  return `${o.company}: your secure payment link for job ${o.job} (${o.amount}): ${o.url}${z} Questions? Call ${o.phone}. Reply STOP to opt out.`;
}

export async function sendSms(to: string, body: string, env: NodeJS.ProcessEnv = process.env): Promise<SmsResult> {
  const mode = smsMode(env);
  if (!mode) return { ok: false, mode: null, error: "Texting is not set up yet (SMS API pending)." };
  const e164 = toE164(to);
  if (!e164) return { ok: false, mode, error: "The customer's phone number is not a valid US number." };
  const sid = env.TWILIO_ACCOUNT_SID!.trim();
  const params = new URLSearchParams({ To: e164, Body: body });
  if (env.TWILIO_MESSAGING_SERVICE_SID?.trim()) params.set("MessagingServiceSid", env.TWILIO_MESSAGING_SERVICE_SID.trim());
  else params.set("From", env.TWILIO_FROM!.trim());
  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
      method: "POST",
      headers: { Authorization: `Basic ${Buffer.from(`${sid}:${env.TWILIO_AUTH_TOKEN!.trim()}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
      signal: AbortSignal.timeout(15_000),
    });
    const json = await res.json().catch(() => ({})) as { sid?: string; message?: string };
    if (!res.ok) return { ok: false, mode, error: (json.message || `Twilio error ${res.status}`).slice(0, 200) };
    return { ok: true, mode, id: String(json.sid || "") };
  } catch (e) {
    return { ok: false, mode, error: e instanceof Error ? e.message.slice(0, 200) : "Text failed." };
  }
}
