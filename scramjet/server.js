// server.js
// Ultra-robust proxy with login redirect, asset passthrough, exhaustive MIME coverage,
// double-rewrite guards, source-map handling, wasm/font correctness,
// cookie preservation, strict nosniff-safe responses, and debug logging.

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

// Exhaustive MIME map
const MIME_BY_EXT = (path) => {
  const p = path.toLowerCase();
  if (p.endsWith(".js") || p.endsWith(".mjs") || p.endsWith(".cjs") || p.endsWith(".jsx")) return "application/javascript";
  if (p.endsWith(".ts") || p.endsWith(".tsx")) return "application/typescript";
  if (p.endsWith(".css") || p.endsWith(".less") || p.endsWith(".sass") || p.endsWith(".scss")) return "text/css";
  if (p.endsWith(".html") || p.endsWith(".htm")) return "text/html";
  if (p.endsWith(".xhtml")) return "application/xhtml+xml";
  if (p.endsWith(".xml")) return "application/xml";
  if (p.endsWith(".json")) return "application/json";
  if (p.endsWith(".map")) return "application/json";
  if (p.endsWith(".webmanifest") || p.endsWith(".manifest")) return "application/manifest+json";
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
  if (p.endsWith(".woff2")) return "font/woff2";
  if (p.endsWith(".woff")) return "font/woff";
  if (p.endsWith(".ttf")) return "font/ttf";
  if (p.endsWith(".otf")) return "font/otf";
  if (p.endsWith(".eot")) return "application/vnd.ms-fontobject";
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
  if (p.endsWith(".pdf")) return "application/pdf";
  if (p.endsWith(".zip")) return "application/zip";
  if (p.endsWith(".tar")) return "application/x-tar";
  if (p.endsWith(".gz")) return "application/gzip";
  if (p.endsWith(".bz2")) return "application/x-bzip2";
  if (p.endsWith(".7z")) return "application/x-7z-compressed";
  if (p.endsWith(".rar")) return "application/vnd.rar";
  if (p.endsWith(".txt")) return "text/plain";
  if (p.endsWith(".csv")) return "text/csv";
  if (p.endsWith(".md")) return "text/markdown";
  if (p.endsWith(".yml") || p.endsWith(".yaml")) return "text/yaml";
  if (p.endsWith(".ini") || p.endsWith(".log")) return "text/plain";
  if (p.endsWith(".wasm")) return "application/wasm";
  if (p.endsWith(".swf")) return "application/x-shockwave-flash";
  return null;
};

const EXECUTABLE_OR_RENDERED = [".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx", ".css", ".map", ".wasm", ".woff", ".woff2"];
const isExecutableOrRendered404 = (path) => EXECUTABLE_OR_RENDERED.some((ext) => path.toLowerCase().endsWith(ext));

const setStrictMimeIfNeeded = (res, url, ct) => {
  if (!ct || ct === "application/octet-stream") {
    const mime = MIME_BY_EXT(url);
    if (mime) res.setHeader("Content-Type", mime);
  }
  if (url.toLowerCase().endsWith(".wasm")) res.setHeader("Content-Type", "application/wasm");
};

// Explicit login redirect
app.get("/login", (req, res) => {
  res.redirect("/browse/" + enc("https://discord.com/login"));
});

// Asset passthrough
app.get("/assets/*", async (req, res) => {
  const assetPath = req.params[0];
  const assetUrl = `https://discord.com/assets/${assetPath}`;
  console.log("Proxying asset:", assetUrl);

  try {
    const upstream = await fetch(assetUrl, {
      redirect: "manual",
      headers: { "User-Agent": "Mozilla/5.0", "Origin": "https://discord.com", "Referer": "https://discord.com/" }
    });

    if (String(upstream.status).startsWith("3")) {
      const loc = upstream.headers.get("location");
      if (loc) return res.redirect("/browse/" + enc(new URL(loc, assetUrl).toString()));
      return res.status(upstream.status).end();
    }

    upstream.headers.forEach((v, k) => { if (!BLOCKED_HEADERS.includes(k.toLowerCase())) res.setHeader(k, v); });
    const ct = upstream.headers.get("content-type") || "";
    setStrictMimeIfNeeded(res, assetUrl, ct);

    if (upstream.status === 404 && isExecutableOrRendered404(assetUrl)) {
      console.warn("404 asset:", assetUrl);
      res.setHeader("Content-Type", MIME_BY_EXT(assetUrl) || "application/octet-stream");
      return res.status(200).send("");
    }

    const buffer = Buffer.from(await upstream.arrayBuffer());
    return res.status(upstream.status).end(buffer);

  } catch (err) {
    console.error("Asset proxy error:", err);
    return res.status(500).send("Asset proxy error: " + err.message);
  }
});

// Main browsing route
app.get("/browse/*", async (req, res) => {
  const target = decodeURIComponent(req.params[0]);
  console.log("Proxying:", target);

  try {
    const upstream = await fetch(target, {
      redirect: "manual",
      headers: { "User-Agent": "Mozilla/5.0", "Origin": "https://discord.com", "Referer": target }
    });

    if (String(upstream.status).startsWith("3")) {
      const loc = upstream.headers.get("location");
      if (loc) return res.redirect("/browse/" + enc(new URL(loc, target).toString()));
      return res.status(upstream.status).end();
    }

    upstream.headers.forEach((v, k) => { if (!BLOCKED_HEADERS.includes(k.toLowerCase())) res.setHeader(k, v); });
    const ct = upstream.headers.get("content-type") || "";

    if (ct.includes("text/html")) {
      let html = await upstream.text();
      const origin = new URL(target).origin;

      html = html.replace(
        /(href|src|action)=["']([^"']+)["']/gi,
        (_, attr, url) => {
          if (url.startsWith("/browse/") || url.includes("/browse/https")) return `${attr}="${url}"`;
          if (/^\/assets\/[^"']
