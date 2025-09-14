// _worker.js (diagnostic build)
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "*";

    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": origin,
          "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
          "Access-Control-Allow-Headers": "content-type",
          "Vary": "Origin",
        },
      });
    }

    // Health
    if (url.pathname === "/api/health") {
      return new Response("OK", {
        status: 200,
        headers: { "content-type": "text/plain", "Access-Control-Allow-Origin": origin, "Vary": "Origin" },
      });
    }

    // Quick check to confirm env vars are loaded
    if (url.pathname === "/api/debug-vars") {
      return new Response(JSON.stringify({
        has_MAIL_FROM: Boolean(env.MAIL_FROM),
        MAIL_FROM: env.MAIL_FROM || null,
        SITE_NAME: env.SITE_NAME || null
      }), { status: 200, headers: { "content-type": "application/json", "Access-Control-Allow-Origin": origin, "Vary": "Origin" }});
    }

    // Email capture
    if (url.pathname === "/api/badge") {
      if (request.method !== "POST") {
        return new Response("Method Not Allowed", {
          status: 405,
          headers: { "Allow": "POST", "Access-Control-Allow-Origin": origin, "Vary": "Origin" },
        });
      }

      try {
        const ct = (request.headers.get("content-type") || "").toLowerCase();
        if (!ct.includes("application/json")) {
          return new Response("Expected application/json", { status: 415, headers: { "Access-Control-Allow-Origin": origin, "Vary": "Origin" } });
        }

        const body = await request.json().catch(() => null);
        if (!body) {
          return new Response("Bad JSON", { status: 400, headers: { "Access-Control-Allow-Origin": origin, "Vary": "Origin" } });
        }

        const { email, city, badge, consent, sessionId, referrer } = body;

        const emailOk = typeof email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
        if (!emailOk || !badge || consent !== true) {
          return new Response("Missing required fields", { status: 400, headers: { "Access-Control-Allow-Origin": origin, "Vary": "Origin" } });
        }

        // Optional KV
        let stored = false;
        if (env.KV_BADGES) {
          try {
            const key = `badge:${sessionId || crypto.randomUUID()}`;
            await env.KV_BADGES.put(key, JSON.stringify({
              email: email.trim(),
              city: String(city || ""),
              badge: String(badge || ""),
              consent: true,
              referrer: String(referrer || ""),
              ts: new Date().toISOString(),
            }), { expirationTtl: 60 * 60 * 24 * 365 });
            stored = true;
          } catch (e) {
            // non-fatal
          }
        }

        // Send via MailChannels
        let sent = false;
        let mailStatus = 0;
        let mailError = "";

        if (env.MAIL_FROM) {
          try {
            const site = env.SITE_NAME || "Ready to Relate";
            const subject = `${site} – Badge saved`;
            const text =
`Thanks! We saved your badge code ${badge}.
Keep it handy if you want to share or verify it later.

If you didn’t request this, you can ignore this email.`;

            const payload = {
              personalizations: [{ to: [{ email: email.trim() }] }],
              from: { email: env.MAIL_FROM, name: site },
              reply_to: { email: env.MAIL_FROM, name: site }, // safe default
              subject,
              content: [{ type: "text/plain", value: text }],
            };

            const mc = await fetch("https://api.mailchannels.net/tx/v1/send", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(payload),
            });

            mailStatus = mc.status;
            sent = mc.ok;
            if (!mc.ok) {
              mailError = await mc.text().catch(() => "");
            }
          } catch (e) {
            mailError = String(e && e.message ? e.message : e);
          }
        }

        return new Response(JSON.stringify({ ok: true, stored, sent, status: mailStatus, error: mailError }), {
          status: 200,
          headers: {
            "content-type": "application/json",
            "Access-Control-Allow-Origin": origin,
            "Vary": "Origin",
          },
        });
      } catch (e) {
        return new Response("Server error", { status: 500, headers: { "Access-Control-Allow-Origin": origin, "Vary": "Origin" } });
      }
    }

    // Static assets
    return env.ASSETS.fetch(request);
  },
};
