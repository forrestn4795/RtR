\
// /functions/api/badge.ts
// Cloudflare Pages Function using MailChannels API (no Email Routing/binding required)
// Sends you an email with {email, city, badge, sessionId, referrer, ip, ua, timestamp}
// and optionally posts the same payload to a Google Sheets Apps Script webhook.
//
// Set these Environment Variables in Cloudflare Pages/Workers (Settings → Variables)
//   CAPTURE_TO        e.g., "captures@yourdomain.com"
//   SENDER_FROM       e.g., "no-reply@readytorelate.com"
//   REQUIRE_CONSENT   "true" to enforce consent flag
//   APP_SCRIPT_URL    (optional) your Apps Script Web App URL
//   APP_SCRIPT_SECRET (optional) shared secret that the Apps Script checks
//
// No bindings are required.

export interface Env {
  CAPTURE_TO: string;
  SENDER_FROM: string;
  REQUIRE_CONSENT?: string;
  APP_SCRIPT_URL?: string;
  APP_SCRIPT_SECRET?: string;
}

function isEmail(s: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

async function sendViaMailChannels(env: Env, subject: string, text: string) {
  const payload = {
    personalizations: [{ to: [{ email: env.CAPTURE_TO }] }],
    from: { email: env.SENDER_FROM },
    subject,
    content: [{ type: "text/plain", value: text }],
  };

  const resp = await fetch("https://api.mailchannels.net/tx/v1/send", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) {
    const errTxt = await resp.text().catch(() => "");
    throw new Error(`MailChannels error ${resp.status}: ${errTxt}`);
  }
}

async function postToAppsScript(env: Env, body: Record<string, unknown>) {
  if (!env.APP_SCRIPT_URL || !env.APP_SCRIPT_SECRET) return;
  const payload = { secret: env.APP_SCRIPT_SECRET, ...body };
  try {
    await fetch(env.APP_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    // swallow error so email still succeeds
  }
}

export const onRequestPost: PagesFunction<Env> = async (ctx) => {
  try {
    const env = ctx.env;
    const req = ctx.request;
    const ip = req.headers.get("CF-Connecting-IP") || "";
    const ua = req.headers.get("User-Agent") || "";
    const now = new Date().toISOString();

    const { email, city, badge, consent, sessionId, referrer } =
      await req.json<any>();

    if (!email || !badge) return new Response("Bad request", { status: 400 });
    if (!isEmail(email)) return new Response("Invalid email", { status: 400 });
    if ((env.REQUIRE_CONSENT === "true") && consent !== true) {
      return new Response("Consent required", { status: 400 });
    }

    // Prepare common payload
    const record = {
      email,
      city: city || "",
      badge,
      sessionId: sessionId || "",
      referrer: referrer || "",
      ip,
      ua,
      timestamp: now,
      consent: consent === true,
    };

    // Email text
    const subject = "ReadyToRelate: new badge";
    const text =
`Email: ${record.email}
City: ${record.city}
Badge: ${record.badge}
Session: ${record.sessionId}
Referrer: ${record.referrer}
IP: ${record.ip}
UA: ${record.ua}
When: ${record.timestamp}`;

    // 1) Email via MailChannels
    await sendViaMailChannels(env, subject, text);

    // 2) Optional: log to Google Sheet Apps Script
    await postToAppsScript(env, record);

    return new Response("ok", { status: 200 });
  } catch (e: any) {
    return new Response(e?.message ?? "error", { status: 500 });
  }
};
