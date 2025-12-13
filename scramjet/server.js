// server.js
// Hardened proxy with uniform routing, MIME enforcement, and full navigation rewrite coverage.

import express from "express";
import fetch from "node-fetch";

const app = express();
const enc = (url) => encodeURIComponent(url);

// Cookie parser
const parseCookies = (cookieHeader = "") =>
  cookieHeader.split(";").map(v => v.trim()).filter(Boolean).reduce((acc, pair) => {
    const eq = pair.indexOf("=");
    if (eq > -1) acc[pair.slice(0, eq)] = pair.slice(eq + 1);
    return acc;
  }, {});

const BLOCKED_HEADERS = [
  "content-encoding",
  "content-length",
  "transfer-encoding",
  "content-security-policy",
  "x-frame-options",
  "strict-transport-security"
];

const MIME_BY_EXT = (path) => {
  const p = path.toLowerCase();
  if (p.endsWith(".js") || p.endsWith(".mjs") || p.endsWith(".cjs") || p.endsWith(".jsx")) return "application/javascript";
  if (p.endsWith(".ts") || p.endsWith(".tsx")) return "application/typescript";
  if (p.endsWith(".css")) return "text/css";
  if (p.endsWith(".html") || p.endsWith(".htm")) return "text/html";
  if (p.endsWith(".json") || p.endsWith(".map")) return "application/json";
  if (p.endsWith(".png")) return "image/png";
  if (p.endsWith(".jpg") || p.endsWith(".jpeg")) return "image/jpeg";
  if (p.endsWith(".gif")) return "image/gif";
  if (p.endsWith(".webp")) return "image/webp";
  if (p.endsWith(".svg")) return "image/svg+xml";
  if (p.endsWith(".ico")) return "image/x-icon";
  if (p.endsWith(".woff2")) return "font/woff2";
  if (p.endsWith(".woff")) return "font/woff";
  if (p.endsWith(".ttf")) return "font/ttf";
  if (p.endsWith(".otf")) return "font/otf";
  if (p.endsWith(".mp4")) return "video/mp4";
  if (p.endsWith(".webm")) return "video/webm";
  if (p.endsWith(".pdf")) return "application/pdf";
  if (p.endsWith(".wasm")) return "application/wasm";
  return null;
};

const EXECUTABLE_OR_RENDERED = [".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx", ".css", ".map", ".wasm", ".woff", ".woff2"];
const isExecutableOrRendered404 = (path) => EXECUTABLE_OR_RENDERED.some((ext) => path.toLowerCase().endsWith(ext));

const setStrictMimeIfNeeded = (res, url, ct) => {
  const mime = MIME_BY_EXT(url);
  if (!ct || ct === "application/octet-stream" || ct === "text/html") {
    if (mime) res.setHeader("Content-Type", mime);
  }
  if (url.toLowerCase().endsWith(".wasm")) res.setHeader("Content-Type", "application/wasm");
};

// Catch-all: redirect stray root-relative requests using ctx_origin cookie
app.use((req, res, next) => {
  const path = req.path || "/";
  if (path === "/" || path.startsWith("/browse/")) return next();

  const cookies = parseCookies(req.headers.cookie || "");
  const ctxOrigin = cookies.ctx_origin;
  if (ctxOrigin) {
    const target = `${ctxOrigin}${req.originalUrl}`;
    const redirectUrl = `/browse/${enc(target)}`;
    return res.redirect(302, redirectUrl);
  }
  next();
});

// Main proxy route
app.get("/browse/*", async (req, res) => {
  const target = decodeURIComponent(req.params[0]);
  console.log("Proxying:", target);

  try {
    const upstream = await fetch(target, {
      redirect: "manual",
      headers: {
        "User-Agent": req.headers["user-agent"] || "Mozilla/5.0",
        ...(req.headers.origin ? { Origin: req.headers.origin } : {}),
        ...(req.headers.referer ? { Referer: req.headers.referer } : {}),
        ...(req.headers.cookie ? { Cookie: req.headers.cookie } : {})
      }
    });

    const ct = upstream.headers.get("content-type") || "";
    upstream.headers.forEach((v, k) => {
      if (!BLOCKED_HEADERS.includes(k.toLowerCase())) res.setHeader(k, v);
    });

    const origin = new URL(target).origin;
    res.cookie?.("ctx_origin", origin, { httpOnly: false, sameSite: "Lax", path: "/" });

    if (ct.includes("text/html")) {
      let html = await upstream.text();

      // Rewrite attributes (anchors, forms, scripts, etc.)
      html = html.replace(
        /(href|src|action)=["']([^"']+)["']/gi,
        (_, attr, url) => {
          if (url.startsWith("/browse/")) return `${attr}="${url}"`;
          if (/^https?:\/\/discord\.com/i.test(url)) return `${attr}="/browse/${enc(url)}"`;
          if (/^https?:\/\//i.test(url)) return `${attr}="/browse/${enc(url)}"`;
          if (/^\/\/[^/]/.test(url)) return `${attr}="/browse/${enc(`https:${url}`)}"`;
          if (/^\/[^/]/.test(url)) return `${attr}="/browse/${enc(origin + url)}"`;
          return `${attr}="/browse/${enc(origin + "/" + url)}"`;
        }
      );

      // Rewrite JS-based navigation (href, assign, replace, push, document.location, window.open)
      html = html
        .replace(/window\.location\.href\s*=\s*["']\/([^"']+)["']/gi,
                 (m, path) => `window.location.href="/browse/${enc(origin + "/" + path)}"`)
        .replace(/document\.location\s*=\s*["']\/([^"']+)["']/gi,
                 (m, path) => `document.location="/browse/${enc(origin + "/" + path)}"`)
        .replace(/location\.assign\s*\(\s*["']\/([^"']+)["']\s*\)/gi,
                 (m, path) => `location.assign("/browse/${enc(origin + "/" + path)}")`)
        .replace(/location\.replace\s*\(\s*["']\/([^"']+)["']\s*\)/gi,
                 (m, path) => `location.replace("/browse/${enc(origin + "/" + path)}")`)
        .replace(/history\.push\s*\(\s*["']\/([^"']+)["']\s*\)/gi,
                 (m, path) => `history.push("/browse/${enc(origin + "/" + path)}")`)
        .replace(/history\.replace\s*\(\s*["']\/([^"']+)["']\s*\)/gi,
                 (m, path) => `history.replace("/browse/${enc(origin + "/" + path)}")`)
        .replace(/window\.open\s*\(\s*["']\/([^"']+)["']/gi,
                 (m, path) => `window.open("/browse/${enc(origin + "/" + path)}"`);

      // Rewrite absolute discord.com JS navigations
      html = html.replace(/["']https:\/\/discord\.com\/([^"']+)["']/gi,
        (m, path) => `"/browse/${enc("https://discord.com/" + path)}"`);

      // Rewrite fetch/xhr calls
      html = html
        .replace(/fetch\(\s*["']\/(?!\/)/gi, `fetch("/browse/${enc(origin)}/`)
        .replace(/(xhr\.open\(\s*["'](GET|POST|PUT|PATCH|DELETE)["']\s*,\s*["'])\/(?!\/)/gi, `$1/browse/${enc(origin)}/`);

      // Inject base tag for relative resolution
      if (!/[\s]base[\s]/i.test(html)) {
        const baseTag = `<base href="/browse/${enc(origin)}/">`;
        html = html.replace(/<head[^>]*>/i, (m) => `${m}\n${baseTag}`);
      }

      return res.status(upstream.status).send(html);
    }

    if (ct.includes("application/json")) {
      const json = await upstream.text();
      return res.status(upstream.status).send(json);
    }

    const buffer = Buffer.from(await upstream.arrayBuffer());
    setStrictMimeIfNeeded(res, target, ct);

    if (upstream.status === 404 && isExecutableOrRendered404(target)) {
      res.setHeader("Content-Type", MIME_BY_EXT(target) || "application/javascript");
      return res.status(200).send("");
    }

    return
