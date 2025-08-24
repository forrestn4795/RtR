// /functions/api/badge.js
// Cloudflare Pages Function (JavaScript) using MailChannels. No special bindings required.

export const onRequestPost = async (ctx) => {
  try {
    const env = ctx.env || {};
    const req = ctx.request;

    let bodyIn;
    try {
      bodyIn = await req.json();
    } catch {
      return new Response("Bad request", { status: 400 });
    }

    const { email, city, badge, consent, sessionId, referrer } = bodyIn || {};
    if (!email || !badge) return new Response("Bad request", { status: 400 });
    if ((env.REQUIRE_CONSENT === "true") && consent !== true) {
      return new Response("Consent required", { status: 400 });
    }

    const ip = req.headers.get("CF-Connecting-IP") || "";
    const ua = req.headers.get("User-Agent") || "";

    // Send email via MailChannels
    const mail = {
      personalizations: [{ to: [{ email: env.CAPTURE_TO }] }],
      from: { email: env.SENDER_FROM },
      subject: "ReadyToRelate: new badge",
      content: [{
        type: "text/plain",
        value:
`Email: ${email}
City: ${city || ""}
Badge: ${badge}
Session: ${sessionId || ""}
Referrer: ${referrer || ""}
IP: ${ip}
UA: ${ua}
When: ${new Date().toISOString()}`
      }]
    };

    const mcResp = await fetch("https://api.mailchannels.net/tx/v1/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(mail)
    });

    if (!mcResp.ok) {
      const t = await mcResp.text().catch(() => "");
      return new Response("Mail send failed: " + t, { status: 502 });
    }

    // Optional: send to Google Sheets Apps Script
    if (env.APP_SCRIPT_URL && env.APP_SCRIPT_SECRET) {
      try {
        await fetch(env.APP_SCRIPT_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            secret: env.APP_SCRIPT_SECRET,
            email,
            city,
            badge,
            sessionId,
            referrer,
            ip,
            ua
          })
        });
      } catch {
        // ignore logging errors
      }
    }

    return new Response("ok", { status: 200 });
  } catch (e) {
    return new Response("error", { status: 500 });
  }
};
