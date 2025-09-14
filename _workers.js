export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") {
      const origin = request.headers.get("Origin") || "";
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": origin || "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "content-type",
          "Vary": "Origin",
        },
      });
    }

    if (url.pathname === "/api/badge" && request.method === "POST") {
      try {
        const origin = request.headers.get("Origin") || "";
        const cors = { "Access-Control-Allow-Origin": origin || "*", "Vary": "Origin" };

        const ct = request.headers.get("content-type") || "";
        if (!ct.includes("application/json")) return new Response("Expected application/json", { status: 415, headers: cors });

        const body = await request.json().catch(() => null);
        if (!body) return new Response("Bad JSON", { status: 400, headers: cors });

        const { email, city, badge, consent, sessionId, referrer } = body;
        if (!email || !badge || consent !== true) {
          return new Response("Missing required fields", { status: 400, headers: cors });
        }

        if (env.KV_BADGES) {
          const key = `badge:${sessionId || crypto.randomUUID()}`;
          await env.KV_BADGES.put(key, JSON.stringify({ email, city, badge, consent: !!consent, referrer: referrer || "", ts: new Date().toISOString() }));
        }

        if (env.MAIL_FROM) {
          const mailPayload = {
            personalizations: [{ to: [{ email }] }],
            from: { email: env.MAIL_FROM, name: "Ready to Relate" },
            subject: "Ready to Relate – Badge saved",
            content: [{ type: "text/plain", value: `Thanks! We saved your badge code ${badge}.` }],
          };
          await fetch("https://api.mailchannels.net/tx/v1/send", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(mailPayload),
          });
        }

        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json", ...cors } });
      } catch (e) {
        console.error(e);
        return new Response("Server error", { status: 502 });
      }
    }

    return new Response("Not found", { status: 404 });
  },
};
