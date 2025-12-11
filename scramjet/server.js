// server.js
// Scramjet-style proxy with assets passthrough, safe buffering,
// header stripping, HTML+JS rewriting, and strict MIME handling.

import express from "express";
import fetch from "node-fetch";

const app = express();
const enc = (url) => encodeURIComponent(url);

const BLOCKED_HEADERS = [
  "content-encoding",
  "content-length",
  "transfer-encoding",
  "content-security-policy",
  "x-frame-options",
  "strict-transport-security"
];

const MIME_BY_EXT = (path) => {
  if (path.endsWith(".js")) return "application/javascript";
  if (path.endsWith(".css")) return "text/css";
  if (path.endsWith(".svg")) return "image/svg+xml";
  if (path.endsWith(".json")) return "application/json";
  if (path.endsWith(".wasm")) return "application/wasm";
  if (path.endsWith(".woff2")) return "font/woff2";
  if (path.endsWith(".map")) return "application/json";
  return null;
};

// Asset passthrough for requests like /assets/<hash>.js, /assets/<hash>.css, etc.
// These showed up in your logs and were 404 because they didn’t go through /browse/.
app.get("/assets/*", async (req, res) => {
  // Prefer Discord’s canonical asset host. Many assets resolve via discord.com/assets.
  // If you find assets are on cdn.discordapp.com, you can toggle the host below.
  const assetPath = req.params[0]; // e.g., 48c96fabc0a9c9ec.js
  const assetUrl = `https://discord.com/assets/${assetPath}`;
  console.log("Proxying asset:", assetUrl);

  try {
    const upstream = await fetch(assetUrl, {
      redirect: "manual",
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" }
    });

    // Handle redirects for assets (rare)
    if (String(upstream.status).startsWith("3")) {
      const loc = upstream.headers.get("location");
      if (loc) {
        const absolute = new URL(loc, assetUrl).toString();
        return res.redirect("/browse/" + enc(absolute));
      }
      return res.status(upstream.status).end();
    }

    const ct = upstream.headers.get("content-type") || "";
    upstream.headers.forEach((v, k) => {
      const lower = k.toLowerCase();
      if (!BLOCKED_HEADERS.includes(lower)) res.setHeader(k, v);
    });

    // Strict MIME: if upstream lacks/incorrect, set by extension
    const fallback = MIME_BY_EXT(assetUrl);
    if (!ct && fallback) res.setHeader("Content-Type", fallback);
    // Special case: wasm must be application/wasm for instantiateStreaming
    if (assetUrl.endsWith(".wasm")) res.setHeader("Content-Type", "application/wasm");

    // If 404 for script/style/wasm/font, serve an empty body with correct MIME to avoid nosniff + syntax explosions
    if (
      upstream.status === 404 &&
      (assetUrl.endsWith(".js") || assetUrl.endsWith(".css") || assetUrl.endsWith(".wasm") || assetUrl.endsWith(".woff2"))
    ) {
      console.warn("404 asset:", assetUrl);
      const mime = MIME_BY_EXT(assetUrl) || "application/octet-stream";
      res.setHeader("Content-Type", mime);
      return res.status(200).send("");
    }

    // Stream response
    const buffer = Buffer.from(await upstream.arrayBuffer());
    return res.status(upstream.status).end(buffer);

  } catch (err) {
    console.error("Asset proxy error:", err);
    return res.status(500).send("Asset proxy error: " + err.message);
  }
});

// Main browsing route for full pages and absolute URLs
app.get("/browse/*", async (req, res) => {
  const target = decodeURIComponent(req.params[0]);
  console.log("Proxying:", target);

  try {
    const upstream = await fetch(target, {
      redirect: "manual",
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" }
    });

    // Redirect handling
    if (String(upstream.status).startsWith("3")) {
      const loc = upstream.headers.get("location");
      if (loc) {
        const absolute = new URL(loc, target).toString();
        return res.redirect("/browse/" + enc(absolute));
      }
      return res.status(upstream.status).end();
    }

    const ct = upstream.headers.get("content-type") || "";

    // Copy headers while stripping problematic ones
    upstream.headers.forEach((v, k) => {
      const lower = k.toLowerCase();
      if (!BLOCKED_HEADERS.includes(lower)) res.setHeader(k, v);
    });

    // HTML rewriting
    if (ct.includes("text/html")) {
      let html = await upstream.text();
      const u = new URL(target);
      const origin = u.origin;

      // Unified rewrite with guard: handle href/src/action attributes
      html = html.replace(
        /(href|src|action)=["']([^"']+)["']/gi,
        (_, attr, url) => {
          // Skip if already proxied
          if (url.startsWith("/browse/") || url.includes("/browse/https")) return `${attr}="${url}"`;

          // If it’s a direct asset reference like /assets/<hash>.js, route to our assets handler
          if (/^\/assets\/[^"']+$/.test(url)) return `${attr}="/assets/${url.replace(/^\/assets\//, "")}"`;

          // Absolute URL
          if (/^https?:\/\//.test(url)) return `${attr}="/browse/${enc(url)}"`;

          // Protocol-relative
          if (/^\/\/[^/]/.test(url)) return `${attr}="/browse/${enc(`https:${url}`)}"`;

          // Relative path (same-origin)
          return `${attr}="/browse/${enc(origin)}/${url}"`;
        }
      );

      // Rewrite API calls invoked by JS
      html = html
        .replace(/fetch\(\s*["']\/(?!\/)/gi, `fetch("/browse/${enc(origin)}/`)
        .replace(/(xhr\.open\(\s*["']GET["']\s*,\s*["'])\/(?!\/)/gi, `$1/browse/${enc(origin)}/`)
        .replace(/(xhr\.open\(\s*["']POST["']\s*,\s*["'])\/(?!\/)/gi, `$1/browse/${enc(origin)}/`);

      // Rewrite window.location assignments
      html = html.replace(
        /(window\.location(?:\.href|\.assign|\.replace)\s*=\s*["'])([^"']+)["']/gi,
        (_, prefix, url) => {
          if (url.startsWith("/browse/") || url.includes("/browse/https")) return `${prefix}${url}"`;
          if (/^https?:\/\//.test(url)) return `${prefix}/browse/${enc(url)}"`;
          return `${prefix}/browse/${enc(new URL(url, target).toString())}"`;
        }
      );

      return res.status(upstream.status).send(html);
    }

    // JSON passthrough
    if (ct.includes("application/json")) {
      const json = await upstream.text();
      return res.status(upstream.status).send(json);
    }

    // Binary or other content
    const buffer = Buffer.from(await upstream.arrayBuffer());

    // Handle 404 for common executable/rendered asset types to avoid nosniff + syntax errors
    if (
      upstream.status === 404 &&
      (target.endsWith(".js") || target.endsWith(".css") || target.endsWith(".wasm") || target.endsWith(".woff2"))
    ) {
      console.warn("404 upstream:", target);
      const mime = MIME_BY_EXT(target) || "application/octet-stream";
      res.setHeader("Content-Type", mime);
      return res.status(200).send("");
    }

    // Fallback MIME if upstream is missing or generic
    if (!ct || ct === "application/octet-stream") {
      const mime = MIME_BY_EXT(target);
      if (mime) res.setHeader("Content-Type", mime);
    }
    if (target.endsWith(".wasm")) res.setHeader("Content-Type", "application/wasm");

    return res.status(upstream.status).end(buffer);

  } catch (err) {
    console.error("Proxy error:", err);
    return res.status(500).send("Proxy error: " + err.message);
  }
});

// Root tip
app.get("/", (_, res) => {
  res.send(
    'Scramjet proxy is running. Use /browse/<encoded_url>. Assets also available via /assets/<file>.'
  );
});

const port = process.env.PORT || 8080;
app.listen(port, () => console.log(`Scramjet proxy on ${port}`));
