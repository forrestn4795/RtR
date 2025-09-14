// _worker.js — uses Resend Email API
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
          "Access-Control-Allow-Headers": "content-type, authorization",
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

    // Debug vars (confirm env loaded)
    if (url.pathname === "/api/debug-vars") {
      return new Response(JSON.stringify({
        has_MAIL_FROM: Boolean(env.MAIL_FROM),
        MAIL_FROM: env.MAIL_FROM || null,
        has_RESEND_API_KEY: Boolean(env.RESEND_API_KEY),
        SITE_NAME: env.SITE_NAME || null
      }), {
        status: 200,
        headers: { "content-type": "application/json", "Access-Control-Allow-Origin": origin, "Vary": "Origin" },
      });
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
            await env.KV_BADGES.put(
              key,
              JSON.stringify({
                email: email.trim(),
                city: String(city || ""),
                badge: String(badge || ""),
                consent: true,
                referrer: String(referrer || ""),
                ts: new Date().toISOString(),
              }),
              { expirationTtl: 60 * 60 * 24 * 365 }
            );
            stored = true;
          } catch (_) {}
        }

        // ---- Send via Resend ----
        let sent = false;
        let status = 0;
        let error = "";

        const site = env.SITE_NAME || "Ready to Relate";
        // If MAIL_FROM missing/blank, fall back to Resend’s dev sender
        const fromEmail = (env.MAIL_FROM && env.MAIL_FROM.includes("@")) ? env.MAIL_FROM : "onboarding@resend.dev";

        if (env.RESEND_API_KEY) {
          try {
            const subject = `${site} – Badge saved`;
            const text =
`Thanks! We saved your badge code ${badge}.
Keep it handy if you want to share or verify it later.

If you didn’t request this, you can ignore this email.`;

            const payload = {
              from: `${site} <${fromEmail}>`,
              to: [email.trim()],
              subject,
              text,
            };

            const res = await fetch("https://api.resend.com/emails", {
              method: "POST",
              headers: {
                "content-type": "application/json",
                "authorization": `Bearer ${env.RESEND_API_KEY}`,
              },
              body: JSON.stringify(payload),
            });

            status = res.status;
            sent = res.ok; // Resend returns 200 on success
            if (!res.ok) error = await res.text().catch(() => "");
          } catch (e) {
            error = String(e?.message || e);
          }
        } else {
          error = "Missing RESEND_API_KEY";
        }

        return new Response(JSON.stringify({ ok: true, stored, sent, status, error }), {
          status: 200,
          headers: { "content-type": "application/json", "Access-Control-Allow-Origin": origin, "Vary": "Origin" },
        });
      } catch (e) {
        return new Response("Server error", { status: 500, headers: { "Access-Control-Allow-Origin": origin, "Vary": "Origin" } });
      }
    }

    // Static assets (Pages)
    return env.ASSETS.fetch(request);
  },
};
