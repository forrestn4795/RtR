// _worker.js
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

    // Health check
    if (url.pathname === "/api/health") {
      return new Response("OK", {
        status: 200,
        headers: { "content-type": "text/plain", "Access-Control-Allow-Origin": origin, "Vary": "Origin" },
      });
    }

    // Email capture endpoint
    if (url.pathname === "/api/badge") {
      if (request.method !== "POST") {
        return new Response("Method Not Allowed", {
          status: 405,
          headers: { "Allow": "POST", "Access-Control-Allow-Origin": origin, "Vary": "Origin" },
        });
      }
      try {
        const ct = request.headers.get("content-type") || "";
        if (!ct.includes("application/json")) {
          return new Response("Expected application/json", { status: 415, headers: { "Access-Control-Allow-Origin": origin, "Vary": "Origin" } });
        }
        const body = await request.json().catch(() => null);
        if (!body) return new Response("Bad JSON", { status: 400, headers: { "Access-Control-Allow-Origin": origin, "Vary": "Origin" } });

        const { email, city, badge, consent, sessionId, referrer } = body;
        if (!email || !badge || consent !== true) {
          return new Response("Missing required fields", { status: 400, headers: { "Access-Control-Allow-Origin": origin, "Vary": "Origin" } });
        }

        // Success (no KV/email yet)
        return new Response(
          JSON.stringify({ ok: true, email, city, badge, sessionId: sessionId || null, referrer: referrer || "" }),
          { status: 200, headers: { "content-type": "application/json", "Access-Control-Allow-Origin": origin, "Vary": "Origin" } }
        );
      } catch {
        return new Response("Server error", { status: 500, headers: { "Access-Control-Allow-Origin": origin, "Vary": "Origin" } });
      }
    }

    // Let Pages serve static assets (index.html, etc.)
    return env.ASSETS.fetch(request);
  },
};
