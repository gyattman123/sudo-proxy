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
  const p = path.toLowerCase();
  if (p.endsWith(".js") || p.endsWith(".mjs") || p.endsWith(".cjs") || p.endsWith(".jsx")) return "application/javascript";
  if (p.endsWith(".ts") || p.endsWith(".tsx")) return "application/typescript";
  if (p.endsWith(".css") || p.endsWith(".less") || p.endsWith(".sass") || p.endsWith(".scss")) return "text/css";
  if (p.endsWith(".html") || p.endsWith(".htm")) return "text/html";
  if (p.endsWith(".json")) return "application/json";
  if (p.endsWith(".map")) return "application/json";
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
  if (!ct || ct === "application/octet-stream") {
    const mime = MIME_BY_EXT(url);
    if (mime) res.setHeader("Content-Type", mime);
  }
  if (url.toLowerCase().endsWith(".wasm")) res.setHeader("Content-Type", "application/wasm");
};

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
        ...(req.headers.referer ? { Referer: req.headers.referer } : {})
      }
    });

    const ct = upstream.headers.get("content-type") || "";
    upstream.headers.forEach((v, k) => {
      if (!BLOCKED_HEADERS.includes(k.toLowerCase())) res.setHeader(k, v);
    });

    if (ct.includes("text/html")) {
      let html = await upstream.text();
      const origin = new URL(target).origin;

      html = html.replace(
        /(href|src|action)=["']([^"']+)["']/gi,
        (_, attr, url) => {
          if (url.startsWith("/browse/")) return `${attr}="${url}"`;
          if (/^https?:\/\//.test(url)) return `${attr}="/browse/${enc(url)}"`;
          if (/^\/[^/]/.test(url)) return `${attr}="/browse/${enc(origin + url)}"`;
          if (/^\/\/[^/]/.test(url)) return `${attr}="/browse/${enc(`https:${url}`)}"`;
          return `${attr}="/browse/${enc(origin + "/" + url)}"`;
        }
      );

      html = html
        .replace(/fetch\(\s*["']\/(?!\/)/gi, `fetch("/browse/${enc(origin)}/`)
        .replace(/(xhr\.open\(\s*["'](GET|POST|PUT|PATCH|DELETE)["']\s*,\s*["'])\/(?!\/)/gi, `$1/browse/${enc(origin)}/`);

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

    return res.status(upstream.status).end(buffer);

  } catch (err) {
    console.error("Proxy error:", err);
    return res.status(500).send("Proxy error: " + err.message);
  }
});

// Root route
app.get("/", (_, res) => {
  res.send("Proxy is running. Use /browse/<encoded_url>. All traffic flows through /browse/<origin>/<path>.");
});

const port = process.env.PORT || 10000;
app.listen(port, () => console.log(`Proxy listening on ${port}`));
