import express from "express";
import fetch from "node-fetch";
import { rewriteHtml } from "./rewriter.js";

const app = express();
const enc = (url) => encodeURIComponent(url);

const BLOCKED_HEADERS = [
  "content-encoding","content-length","transfer-encoding",
  "content-security-policy","x-frame-options","strict-transport-security"
];

const MIME_BY_EXT = (path) => {
  const p = path.toLowerCase();
  if (p.endsWith(".js")) return "application/javascript";
  if (p.endsWith(".css")) return "text/css";
  if (p.endsWith(".html")) return "text/html";
  if (p.endsWith(".json")) return "application/json";
  if (p.endsWith(".png")) return "image/png";
  if (p.endsWith(".jpg")||p.endsWith(".jpeg")) return "image/jpeg";
  if (p.endsWith(".gif")) return "image/gif";
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

const setStrictMimeIfNeeded = (res, url, ct) => {
  const mime = MIME_BY_EXT(url);
  if (!ct || ct === "application/octet-stream" || ct === "text/html") {
    if (mime) res.setHeader("Content-Type", mime);
  }
  if (url.toLowerCase().endsWith(".wasm")) res.setHeader("Content-Type", "application/wasm");
};

app.get("/browse/*", async (req, res) => {
  const target = decodeURIComponent(req.params[0]);
  console.log("Proxying:", target);
  try {
    const upstream = await fetch(target, { redirect: "manual" });

    // Handle upstream 3xx redirects
    if (upstream.status >= 300 && upstream.status < 400) {
      const loc = upstream.headers.get("location");
      if (loc) {
        return res.redirect(302, `/browse/${enc(new URL(loc, target).href)}`);
      }
    }

    const ct = upstream.headers.get("content-type") || "";
    upstream.headers.forEach((v,k)=>{ if (!BLOCKED_HEADERS.includes(k.toLowerCase())) res.setHeader(k,v); });
    const origin = new URL(target).origin;

    if (ct.includes("text/html")) {
      let html = await upstream.text();
      html = rewriteHtml(html, origin, "/browse/");
      return res.status(upstream.status).send(html);
    }

    if (ct.includes("application/json")) {
      return res.status(upstream.status).send(await upstream.text());
    }

    const buffer = Buffer.from(await upstream.arrayBuffer());
    setStrictMimeIfNeeded(res, target, ct);

    return res.status(upstream.status).end(buffer);

  } catch (err) {
    console.error("Proxy error:", err);
    return res.status(500).send("Proxy error: " + err.message);
  }
});

// Root route
app.get("/", (_, res) => {
  res.send("Proxy running. Use /browse/<encoded_url>.");
});

const port = process.env.PORT || 10000;
app.listen(port, () => console.log(`Proxy listening on ${port}`));
