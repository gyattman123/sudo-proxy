// server.js
// Ultra-robust proxy with asset passthrough, exhaustive MIME coverage,
// double-rewrite guards, source-map handling, wasm/font correctness,
// cookie preservation, strict nosniff-safe responses, and debug logging.

import express from "express";
import fetch from "node-fetch";

const app = express();
const enc = (url) => encodeURIComponent(url);

// Strip only truly dangerous hop-by-hop or anti-embed headers.
// We PRESERVE content-type and set-cookie to keep sessions working.
const BLOCKED_HEADERS = [
  "content-encoding",
  "content-length",
  "transfer-encoding",
  "content-security-policy",
  "x-frame-options",
  "strict-transport-security"
];

// Exhaustive MIME map by extension (add more as needed).
const MIME_BY_EXT = (path) => {
  const p = path.toLowerCase();

  // Scripts and modules
  if (p.endsWith(".js")) return "application/javascript";
  if (p.endsWith(".mjs")) return "application/javascript";
  if (p.endsWith(".cjs")) return "application/javascript";
  if (p.endsWith(".ts")) return "application/typescript";
  if (p.endsWith(".tsx")) return "application/typescript";
  if (p.endsWith(".jsx")) return "application/javascript";

  // Styles
  if (p.endsWith(".css")) return "text/css";
  if (p.endsWith(".less")) return "text/css";
  if (p.endsWith(".sass")) return "text/css";
  if (p.endsWith(".scss")) return "text/css";

  // HTML/XML/manifest
  if (p.endsWith(".html") || p.endsWith(".htm")) return "text/html";
  if (p.endsWith(".xhtml")) return "application/xhtml+xml";
  if (p.endsWith(".xml")) return "application/xml";
  if (p.endsWith(".json")) return "application/json";
  if (p.endsWith(".map")) return "application/json"; // source maps are JSON
  if (p.endsWith(".webmanifest") || p.endsWith(".manifest")) return "application/manifest+json";

  // Images
  if (p.endsWith(".png")) return "image/png";
  if (p.endsWith(".jpg") || p.endsWith(".jpeg")) return "image/jpeg";
  if (p.endsWith(".gif")) return "image/gif";
  if (p.endsWith(".webp")) return "image/webp";
  if (p.endsWith(".svg")) return "image/svg+xml";
  if (p.endsWith(".ico")) return "image/x-icon";
  if (p.endsWith(".bmp")) return "image/bmp";
  if (p.endsWith(".tif") || p.endsWith(".tiff")) return "image/tiff";
  if (p.endsWith(".avif")) return "image/avif";
  if (p.endsWith(".apng")) return "image/apng";

  // Fonts
  if (p.endsWith(".woff2")) return "font/woff2";
  if (p.endsWith(".woff")) return "font/woff";
  if (p.endsWith(".ttf")) return "font/ttf";
  if (p.endsWith(".otf")) return "font/otf";
  if (p.endsWith(".eot")) return "application/vnd.ms-fontobject";

  // Audio/Video
  if (p.endsWith(".mp3")) return "audio/mpeg";
  if (p.endsWith(".wav")) return "audio/wav";
  if (p.endsWith(".ogg")) return "audio/ogg";
  if (p.endsWith(".m4a")) return "audio/mp4";
  if (p.endsWith(".flac")) return "audio/flac";
  if (p.endsWith(".aac")) return "audio/aac";
  if (p.endsWith(".weba")) return "audio/webm";

  if (p.endsWith(".mp4")) return "video/mp4";
  if (p.endsWith(".webm")) return "video/webm";
  if (p.endsWith(".ogv")) return "video/ogg";
  if (p.endsWith(".mov")) return "video/quicktime";
  if (p.endsWith(".mkv")) return "video/x-matroska";
  if (p.endsWith(".avi")) return "video/x-msvideo";

  // Docs/archives
  if (p.endsWith(".pdf")) return "application/pdf";
  if (p.endsWith(".zip")) return "application/zip";
  if (p.endsWith(".tar")) return "application/x-tar";
  if (p.endsWith(".gz")) return "application/gzip";
  if (p.endsWith(".bz2")) return "application/x-bzip2";
  if (p.endsWith(".7z")) return "application/x-7z-compressed";
  if (p.endsWith(".rar")) return "application/vnd.rar";

  // Code/text
  if (p.endsWith(".txt")) return "text/plain";
  if (p.endsWith(".csv")) return "text/csv";
  if (p.endsWith(".md")) return "text/markdown";
  if (p.endsWith(".yml") || p.endsWith(".yaml")) return "text/yaml";
  if (p.endsWith(".ini")) return "text/plain";
  if (p.endsWith(".log")) return "text/plain";

  // Binary/web
  if (p.endsWith(".wasm")) return "application/wasm";
  if (p.endsWith(".swf")) return "application/x-shockwave-flash";

  // Fallback
  return null;
};

// File types that should not be executed if 404 (avoid nosniff + syntax/runtime explosions)
const EXECUTABLE_OR_RENDERED = [
  ".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx",
  ".css", ".map",
  ".wasm",
  ".woff", ".woff2"
];

const isExecutableOrRendered404 = (path) => {
  const p = path.toLowerCase();
  return EXECUTABLE_OR_RENDERED.some((ext) => p.endsWith(ext));
};

// Helper to set strict MIME if missing/generic
const setStrictMimeIfNeeded = (res, url, ct) => {
  if (!ct || ct === "application/octet-stream") {
    const mime = MIME_BY_EXT(url);
    if (mime) res.setHeader("Content-Type", mime);
  }
  // wasm must be explicit for instantiateStreaming
  if (url.toLowerCase().endsWith(".wasm")) {
    res.setHeader("Content-Type", "application/wasm");
  }
};

// Assets passthrough: handle /assets/<file> directly from discord.com/assets
app.get("/assets/*", async (req, res) => {
  const assetPath = req.params[0]; // e.g., 48c96fabc0a9c9ec.js
  // Primary host; add CDN fallback if needed later.
  let assetUrl = `https://discord.com/assets/${assetPath}`;
  console.log("Proxying asset:", assetUrl);

  try {
    const upstream = await fetch(assetUrl, {
      redirect: "manual",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        "Origin": "https://discord.com",
        "Referer": "https://discord.com/"
      }
    });

    // Redirects (rare for assets)
    if (String(upstream.status).startsWith("3")) {
      const loc = upstream.headers.get("location");
      if (loc) {
        const absolute = new URL(loc, assetUrl).toString();
        return res.redirect("/browse/" + enc(absolute));
      }
      return res.status(upstream.status).end();
    }

    // Copy headers (preserve content-type and set-cookie!)
    upstream.headers.forEach((v, k) => {
      const lower = k.toLowerCase();
      if (!BLOCKED_HEADERS.includes(lower)) res.setHeader(k, v);
    });

    const ct = upstream.headers.get("content-type") || "";
    setStrictMimeIfNeeded(res, assetUrl, ct);

    // If 404 for executable/rendered assets, serve empty body with correct MIME to avoid nosniff + syntax errors
    if (upstream.status === 404 && isExecutableOrRendered404(assetUrl)) {
      console.warn("404 asset:", assetUrl);
      const mime = MIME_BY_EXT(assetUrl) || "application/octet-stream";
      res.setHeader("Content-Type", mime);
      return res.status(200).send("");
    }

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
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        "Origin": "https://discord.com",
        "Referer": target.startsWith("http") ? target : "https://discord.com/"
      }
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

    // Copy headers while stripping problematic ones (keep content-type and set-cookie!)
    upstream.headers.forEach((v, k) => {
      const lower = k.toLowerCase();
      if (!BLOCKED_HEADERS.includes(lower)) res.setHeader(k, v);
    });

    const ct = upstream.headers.get("content-type") || "";

    // HTML rewriting
    if (ct.includes("text/html")) {
      let html = await upstream.text();
      const u = new URL(target);
      const origin = u.origin;

      // Guarded rewrite for href/src/action
      html = html.replace(
        /(href|src|action)=["']([^"']+)["']/gi,
        (_, attr, url) => {
          // Already proxied
          if (url.startsWith("/browse/") || url.includes("/browse/https")) return `${attr}="${url}"`;

          // Route clean asset references through /assets
          if (/^\/assets\/[^"']+$/.test(url)) return `${attr}="/assets/${url.replace(/^\/assets\//, "")}"`;
          if (/^[^\/]*assets\/[^"']+$/.test(url)) {
            // e.g., assets/<file> (relative); send to /assets
            const file = url.replace(/^.*assets\//, "");
            return `${attr}="/assets/${file}"`;
          }

          // Absolute URL
          if (/^https?:\/\//.test(url)) return `${attr}="/browse/${enc(url)}"`;

          // Protocol-relative
          if (/^\/\/[^/]/.test(url)) return `${attr}="/browse/${enc(`https:${url}`)}"`;

          // Special-case source maps: ensure origin is included
          if (url.toLowerCase().endsWith(".map")) return `${attr}="/browse/${enc(origin)}/${url}"`;

          // Relative path (same-origin)
          return `${attr}="/browse/${enc(origin)}/${url}"`;
        }
      );

      // Rewrite direct fetch/xhr of relative paths
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

      // Optional: silence devtools source-map noise by returning empty JSON for .map
      html = html.replace(
        /(["'])[^"']+\.map\1/g,
        (m) => m // keep refs (we handle in server), or comment this out if you want to strip them
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
    if (upstream.status === 404 && isExecutableOrRendered404(target)) {
      console.warn("404 upstream:", target);
      const mime = MIME_BY_EXT(target) || "application/octet-stream";
      res.setHeader("Content-Type", mime);
      return res.status(200).send("");
    }

    setStrictMimeIfNeeded(res, target, ct);
    return res.status(upstream.status).end(buffer);

  } catch (err) {
    console.error("Proxy error:", err);
    return res.status(500).send("Proxy error: " + err.message);
  }
});

// Optional: convenience route to proxy a simple page
app.get("/", (_, res) => {
  res.send(
    'Proxy is running. Use /browse/<encoded_url>. Assets are proxied via /assets/<file>.'
  );
});

const port = process.env.PORT || 8080;
app.listen(port, () => console.log(`Proxy listening on ${port}`));
