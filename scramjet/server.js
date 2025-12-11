// server.js
// Scramjet-style HTTP proxy with safe buffering, header stripping,
// and HTML rewriting for relative + absolute links and API calls.

import express from "express";
import fetch from "node-fetch";

const app = express();

// Utility: encode a full URL for /browse/<encoded>
const enc = (url) => encodeURIComponent(url);

// Block/normalize problematic headers from upstream
const BLOCKED_HEADERS = [
  "content-encoding",
  "content-length",
  "transfer-encoding",
  "content-security-policy",
  "x-frame-options",
  "set-cookie",
  "strict-transport-security"
];

// Main proxy route: captures everything after /browse/
app.get("/browse/*", async (req, res) => {
  const target = decodeURIComponent(req.params[0]);

  try {
    const upstream = await fetch(target, {
      redirect: "manual",
      headers: {
        // Keep it simple and broadly compatible
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
      }
    });

    // Handle 3xx redirects by re-wrapping the location through the proxy
    if (String(upstream.status).startsWith("3")) {
      const loc = upstream.headers.get("location");
      if (loc) {
        const absolute = new URL(loc, target).toString();
        return res.redirect("/browse/" + enc(absolute));
      }
      return res.status(upstream.status).end();
    }

    // Copy headers but strip/normalize problematic ones
    upstream.headers.forEach((v, k) => {
      const lower = k.toLowerCase();
      if (!BLOCKED_HEADERS.includes(lower)) {
        res.setHeader(k, v);
      }
    });

    const ct = upstream.headers.get("content-type") || "";

    // HTML: rewrite links, assets, API calls so navigation stays inside proxy
    if (ct.includes("text/html")) {
      let html = await upstream.text();
      const u = new URL(target);
      const origin = u.origin;

      // 1) Rewrite relative URLs (href/src/action starting with "/")
      //    /path -> /browse/<origin>/path
      html = html.replace(
        /(href|src|action)=["']\/(?!\/)/gi,
        (_, attr) => `${attr}="/browse/${enc(origin)}/`
      );

      // 2) Rewrite same-origin relative URLs (no leading slash), e.g., href="login"
      //    login -> /browse/<origin>/login
      html = html.replace(
        /(href|src|action)=["'](?!https?:\/\/|\/\/|#|mailto:|tel:)([^"']+)["']/gi,
        (_, attr, path) => `${attr}="/browse/${enc(origin)}/${path}"`
      );

      // 3) Rewrite protocol-relative URLs (//example.com/...)
      html = html.replace(
        /(href|src|action)=["']\/\/([^"']+)["']/gi,
        (_, attr, rest) => `${attr}="/browse/${enc(`https://${rest}`)}"`
      );

      // 4) Rewrite absolute URLs (https://domain/... or http://domain/...)
      html = html.replace(
        /(href|src|action)=["']https?:\/\/[^"']+["']/gi,
        (match) => {
          const url = match.split(/=["']/)[1].replace(/["']$/, "");
          return `${match.slice(0, match.indexOf("="))}="/browse/${enc(url)}"`;
        }
      );

      // 5) Rewrite common JS API calls to go through proxy (fetch, XHR)
      //    fetch("/api/...") -> fetch("/browse/<origin>/api/...")
      html = html
        .replace(/fetch\(\s*["']\/(?!\/)/gi, `fetch("/browse/${enc(origin)}/`)
        .replace(/(xhr\.open\(\s*["']GET["']\s*,\s*["'])\/(?!\/)/gi, `$1/browse/${enc(origin)}/`)
        .replace(/(xhr\.open\(\s*["']POST["']\s*,\s*["'])\/(?!\/)/gi, `$1/browse/${enc(origin)}/`);

      // 6) Optional: fix window.location.href assignments to absolute URLs
      //    window.location.href = "https://domain/path" -> /browse/<encoded>
      html = html.replace(
        /(window\.location(?:\.href|\.assign|\.replace)\s*=\s*["'])https?:\/\/([^"']+)["']/gi,
        (_, prefix, rest) => `${prefix}/browse/${enc(`https://${rest}`)}"`
      );

      res.status(upstream.status).send(html);
      return;
    }

    // JSON: pass through as text (safe), headers already normalized
    if (ct.includes("application/json")) {
      const json = await upstream.text();
      res.status(upstream.status).send(json);
      return;
    }

    // Everything else (binary, CSS, JS, images, fonts): buffer safely
    const buffer = Buffer.from(await upstream.arrayBuffer());
    res.status(upstream.status).end(buffer);
  } catch (err) {
    res.status(500).send("Proxy error: " + err.message);
  }
});

// Health check / root hint
app.get("/", (_, res) => {
  res.send(
    'Scramjet proxy is running. Use /browse/<encoded_url>. Example: /browse/https%3A%2F%2Fexample.com'
  );
});

const port = process.env.PORT || 8080;
app.listen(port, () => console.log(`Scramjet proxy on ${port}`));
