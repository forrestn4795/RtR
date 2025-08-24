\
// /functions/api/badge.ts
// Cloudflare Pages Function that emails you {email, city, badge, sessionId, referrer}
// and (optionally) logs each submission to a Google Sheet via Apps Script.
// Configure email binding (SEB) and env vars in Cloudflare Pages settings.

import { EmailMessage } from "cloudflare:email";

export interface Env {
  // Email binding (configure in Cloudflare: Functions -> Settings -> Email)
  SEB: any;

  // Environment variables (configure in Pages -> Settings -> Environment variables)
  CAPTURE_TO: string;        // e.g., "captures@yourdomain.com"
  SENDER_FROM: string;       // e.g., "no-reply@readytorelate.com"
  REQUIRE_CONSENT?: string;  // "true" to enforce consent === true

  // Optional Google Sheets webhook (Apps Script) for logging
  APP_SCRIPT_URL?: string;   // Web App URL from your Apps Script deployment
  APP_SCRIPT_SECRET?: string;// Same secret string used in Apps Script
}

function isEmail(s: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

export const onRequestPost: PagesFunction<Env> = async (ctx) => {
  try {
    const env = ctx.env;
    const { email, city, badge, consent, sessionId, referrer } = await ctx.request.json<any>();
    if (!email || !badge) return new Response("Bad request", { status: 400 });
    if (!isEmail(email)) return new Response("Invalid email", { status: 400 });
    if ((env.REQUIRE_CONSENT === "true") && consent !== true) {
      return new Response("Consent required", { status: 400 });
    }

    const ip = ctx.request.headers.get("CF-Connecting-IP") || "";
    const ua = ctx.request.headers.get("User-Agent") || "";

    // 1) Send you an email
    const subject = "ReadyToRelate: new badge";
    const body =
`Email: ${email}
City: ${city || ""}
Badge: ${badge}
Session: ${sessionId || ""}
Referrer: ${referrer || ""}
IP: ${ip}
UA: ${ua}
When: ${new Date().toISOString()}`;

    const message = new EmailMessage(env.SENDER_FROM, env.CAPTURE_TO, subject, body);
    await env.SEB.send(message);

    // 2) Optional: log to Google Sheets via Apps Script
    if (env.APP_SCRIPT_URL && env.APP_SCRIPT_SECRET) {
      try {
        await fetch(env.APP_SCRIPT_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            secret: env.APP_SCRIPT_SECRET,
            email,
            city: city || "",
            badge,
            sessionId: sessionId || "",
            referrer: referrer || "",
            ip,
            ua
          })
        });
      } catch (_) {
        // Don't fail the request if the Sheet is down.
      }
    }

    return new Response("ok", { status: 200 });
  } catch (e: any) {
    return new Response(e?.message ?? "error", { status: 500 });
  }
};
