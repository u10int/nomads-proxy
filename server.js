"use strict";

/**
 * NOMADS CORS Proxy
 *
 * Forwards HEAD / GET requests to nomads.ncep.noaa.gov on behalf of
 * browser clients that can't reach it directly due to CORS restrictions.
 *
 * Security:
 *  - Only proxies requests to the NOMADS_ALLOWED_HOST (default: nomads.ncep.noaa.gov)
 *  - Optional API-key auth via PROXY_API_KEY env var
 *  - Rate-limited per IP to prevent abuse
 *  - No request body forwarded (HEAD/GET only)
 */

const express  = require("express");
const https    = require("https");
const http     = require("http");
const rateLimit = require("express-rate-limit");

const app = express();

// ─── Config ────────────────────────────────────────────────────────────────

const PORT             = process.env.PORT             || 3000;
const ALLOWED_HOST     = process.env.NOMADS_ALLOWED_HOST || "nomads.ncep.noaa.gov";
const PROXY_API_KEY    = process.env.PROXY_API_KEY    || null;   // optional
const ALLOWED_ORIGINS  = (process.env.ALLOWED_ORIGINS || "*").split(",").map(s => s.trim());
const REQUEST_TIMEOUT  = parseInt(process.env.REQUEST_TIMEOUT_MS || "15000", 10);

// ─── Middleware ─────────────────────────────────────────────────────────────

// CORS
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.includes("*")) {
    res.setHeader("Access-Control-Allow-Origin", "*");
  } else if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "X-API-Key, Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// Rate limiting — 120 req/min per IP
app.use(rateLimit({
  windowMs: 60_000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please slow down." },
}));

// Optional API-key auth
app.use((req, res, next) => {
  if (!PROXY_API_KEY) return next();
  const key = req.headers["x-api-key"];
  if (key !== PROXY_API_KEY) {
    return res.status(401).json({ error: "Unauthorized: invalid or missing X-API-Key header." });
  }
  next();
});

// ─── Health check ───────────────────────────────────────────────────────────

app.get("/health", (_req, res) => {
  res.json({ status: "ok", allowedHost: ALLOWED_HOST, timestamp: new Date().toISOString() });
});

// ─── Proxy endpoint ─────────────────────────────────────────────────────────

/**
 * GET|HEAD /proxy?url=<nomads-url>
 *
 * Returns:
 *  200  { available: true,  url, statusCode, contentLength?, lastModified? }
 *  200  { available: false, url, statusCode }
 *  400  { error: "..." }
 *  502  { error: "...", detail: "..." }
 */
app.use("/proxy", (req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return res.status(405).json({ error: "Method not allowed. Use GET or HEAD." });
  }

  // ── Validate target URL ──────────────────────────────────────────────────
  const rawUrl = req.query.url;
  if (!rawUrl) {
    return res.status(400).json({ error: "Missing required query param: ?url=<target>" });
  }

  let target;
  try {
    target = new URL(rawUrl);
  } catch {
    return res.status(400).json({ error: "Invalid URL: " + rawUrl });
  }

  if (target.hostname !== ALLOWED_HOST) {
    return res.status(400).json({
      error: `Disallowed host "${target.hostname}". Only "${ALLOWED_HOST}" is permitted.`,
    });
  }

  if (target.protocol !== "https:" && target.protocol !== "http:") {
    return res.status(400).json({ error: "Only http/https URLs are allowed." });
  }

  // ── Forward HEAD request to NOMADS ──────────────────────────────────────
  const transport = target.protocol === "https:" ? https : http;

  const options = {
    hostname: target.hostname,
    port:     target.port || (target.protocol === "https:" ? 443 : 80),
    path:     target.pathname + target.search,
    method:   "HEAD",
    headers:  {
      "User-Agent": "nomads-cors-proxy/1.0",
      "Accept":     "*/*",
    },
    timeout: REQUEST_TIMEOUT,
  };

  const upstream = transport.request(options, (upstreamRes) => {
    const { statusCode, headers } = upstreamRes;

    // Drain the body (HEAD response has no body, but just in case)
    upstreamRes.resume();

    const available = statusCode >= 200 && statusCode < 400;

    const payload = {
      available,
      url:        rawUrl,
      statusCode,
      ...(headers["content-length"] && { contentLength: parseInt(headers["content-length"], 10) }),
      ...(headers["last-modified"]  && { lastModified: headers["last-modified"] }),
    };

    res.status(200).json(payload);
  });

  upstream.on("timeout", () => {
    upstream.destroy();
    res.status(504).json({ error: "Upstream request timed out.", url: rawUrl });
  });

  upstream.on("error", (err) => {
    if (res.headersSent) return;
    res.status(502).json({ error: "Upstream request failed.", detail: err.message, url: rawUrl });
  });

  upstream.end();
});

// ─── 404 fallback ───────────────────────────────────────────────────────────

app.use((_req, res) => {
  res.status(404).json({ error: "Not found. Available endpoints: GET /health, GET /proxy?url=<nomads-url>" });
});

// ─── Start ──────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`NOMADS proxy running on port ${PORT}`);
  console.log(`  Allowed host : ${ALLOWED_HOST}`);
  console.log(`  Auth enabled : ${PROXY_API_KEY ? "yes" : "no"}`);
  console.log(`  CORS origins : ${ALLOWED_ORIGINS.join(", ")}`);
});
