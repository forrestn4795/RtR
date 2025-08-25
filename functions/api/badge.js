//
// /functions/api/badge.js
// Uses MailChannels (no Cloudflare Email Routing needed).
// Adds Reply-To support via env var REPLY_TO (falls back to CAPTURE_TO).
// GET /api/badge -> health check JSON
// POST /api/badge -> validates, emails via MailChannels, optionally logs to Google Sheets Apps Script.
//
// Required ENV:
//   CAPTURE_TO        (e.g., ReadyToRelate@outlook.com)
//   SENDER_FROM       (e.g., no-reply@readytorelate.com)
// Optional ENV:
//   REPLY_TO          (e.g., ReadyToRelate@outlook.com) — if unset, uses CAPTURE_TO
//   APP_SCRIPT_URL    (Apps Script Web App URL for Sheets logging)
//   APP_SCRIPT_SECRET (Shared secret the script expects)
//
const JSON_HEADERS = { "content-type": "application/json" };

export const onRequestGet = async () => {
  return new Response(JSON.stringify({ ok: true, endpoint: "badge", mode: "GET", msg: "alive" }), { status: 200, headers: JSON_HEADERS });
};

export const onRequestPost = async (ctx) => {
  const ip = ctx.request.headers.get("CF-Connecting-IP") || "";
  const ua = ctx.request.headers.get("User-Agent") || "";
  const env = ctx.env || {};
  const errors = [];
  let data = {};

  try {
    const text = await ctx.request.text();
    data = text ? JSON.parse(text) : {};
  } catch (e) {
    errors.push("Invalid JSON body");
  }

  const email = (data.email || "").trim();
  const badge = (data.badge || "").trim();
  const city = (data.city || "").trim();
  const sessionId = (data.sessionId || "").trim();
  const referrer = (data.referrer || "").trim();
  const consent = !!data.consent;

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push("Missing or invalid email");
  if (!badge) errors.push("Missing badge");

  const meta = { ip, ua, time: new Date().toISOString() };
  const resBody = {
    ok: errors.length === 0,
    received: { email, city, badge, sessionId, referrer, consent },
    errors: [...errors],
    steps: {}
  };
  if (errors.length) return new Response(JSON.stringify(resBody), { status: 400, headers: JSON_HEADERS });

  // Prepare MailChannels payload
  const to = env.CAPTURE_TO;
  const from = env.SENDER_FROM;
  const replyTo = env.REPLY_TO || env.CAPTURE_TO || "";

  // 1) Send email (MailChannels)
  let emailStatus = "skipped";
  try {
    if (!to || !from) {
      emailStatus = "skipped_missing_env";
    } else {
      const mcBody = {
        personalizations: [{ to: [{ email: to }] }],
        from: { email: from },
        subject: "ReadyToRelate: new badge",
        content: [{
          type: "text/plain",
          value:
`Email: ${email}
City: ${city}
Badge: ${badge}
Session: ${sessionId}
Referrer: ${referrer}
IP: ${ip}
UA: ${ua}
When: ${meta.time}`
        }],
        headers: replyTo ? { "Reply-To": replyTo } : undefined
      };

      const mc = await fetch("https://api.mailchannels.net/tx/v1/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(mcBody)
      });

      if (!mc.ok) {
        const t = await mc.text().catch(()=>"");
        emailStatus = `failed_${mc.status}`;
        resBody.errors.push(`MailChannels error ${mc.status}: ${t.slice(0,200)}`);
      } else {
        emailStatus = "sent";
      }
    }
  } catch (e) {
    emailStatus = "failed_exception";
    resBody.errors.push(`MailChannels exception: ${String(e).slice(0,180)}`);
  }
  resBody.steps.email = emailStatus;

  // 2) Optional: log to Google Sheets via Apps Script
  let sheetStatus = "skipped";
  try {
    const appUrl = env.APP_SCRIPT_URL;
    const secret = env.APP_SCRIPT_SECRET;
    if (!appUrl || !secret) {
      sheetStatus = "skipped_missing_env";
    } else {
      const payload = { secret, email, city, badge, sessionId, referrer, ip, ua };
      const gs = await fetch(appUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!gs.ok) {
        const t = await gs.text().catch(()=>"");
        sheetStatus = `failed_${gs.status}`;
        resBody.errors.push(`AppsScript error ${gs.status}: ${t.slice(0,200)}`);
      } else {
        sheetStatus = "logged";
      }
    }
  } catch (e) {
    sheetStatus = "failed_exception";
    resBody.errors.push(`AppsScript exception: ${String(e).slice(0,180)}`);
  }
  resBody.steps.sheet = sheetStatus;

  const success = (emailStatus === "sent") || (sheetStatus === "logged");
  resBody.ok = success;
  const status = success ? 200 : 502;

  return new Response(JSON.stringify(resBody), { status, headers: JSON_HEADERS });
};
