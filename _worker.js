// _worker.js — hardened (Resend + CORS + rate limit + no debug endpoint)

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // ----- CORS -----
    const ALLOWED_HOSTS = new Set([
      "https://readytorelate.com",
    ]);
    const originHdr = request.headers.get("Origin") || "";
    const isPagesPreview =
      originHdr.endsWith(".pages.dev") || originHdr.endsWith(".pages.dev/");
    const allowedOrigin = originHdr && (ALLOWED_HOSTS.has(originHdr) || isPagesPreview)
      ? originHdr
      : "https://readytorelate.com"; // default to prod domain

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": allowedOrigin,
          "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
          "Access-Control-Allow-Headers": "content-type, authorization",
          "Vary": "Origin",
        },
      });
    }

    // ----- Health -----
    if (url.pathname === "/api/health") {
      return new Response("OK", {
        status: 200,
        headers: {
          "content-type": "text/plain",
          "Access-Control-Allow-Origin": allowedOrigin,
          "Vary": "Origin",
        },
      });
    }

    // ----- Email capture endpoint -----
    if (url.pathname === "/api/badge") {
      if (request.method !== "POST") {
        return resp(405, { error: "Method Not Allowed" });
      }

      // Parse & validate JSON
      const ct = (request.headers.get("content-type") || "").toLowerCase();
      if (!ct.includes("application/json")) {
        return resp(415, { error: "Expected application/json" });
      }

      let body;
      try {
        body = await request.json();
      } catch (_) {
        return resp(400, { error: "Bad JSON" });
      }

      const { email, city, badge, consent, sessionId, referrer } = body || {};
      const emailOk =
        typeof email === "string" &&
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

      if (!emailOk || !badge || consent !== true) {
        return resp(400, { error: "Missing required fields" });
      }

      // ----- Optional rate limiting (requires KV binding: KV_BADGES) -----
      try {
        if (env.KV_BADGES) {
          const ip = request.headers.get("CF-Connecting-IP") || "anon";
          const bucket = `${new Date().toISOString().slice(0, 13)}`; // YYYY-MM-DDTHH
          const key = `rl:${ip}:${bucket}`;
          const count = parseInt((await env.KV_BADGES.get(key)) || "0", 10);

          if (count >= 2) {
            return resp(200, { ok: true, sent: false, status: 429 }); // soft error for client
          }
          await env.KV_BADGES.put(key, String(count + 1), { expirationTtl: 3600 });
        }
      } catch (e) {
        // don’t fail the request if RL storage errors
        console.warn("Rate-limit check failed:", e?.message || e);
      }

      // ----- (Optional) store record in KV (comment out if you don’t need it) -----
      try {
        if (env.KV_BADGES) {
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
