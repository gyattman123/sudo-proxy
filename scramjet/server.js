import express from "express";
import fetch from "node-fetch";
import path from "path";

const app = express();
const PORT = process.env.PORT || 3000;

// Generic upstream origin (e.g. "https://discord.com")
const UPSTREAM_ORIGIN = process.env.UPSTREAM_ORIGIN || "https://example.com";

// MIME map
const MIME_BY_EXT = {
  ".js": "application/javascript",
  ".css": "text/css",
  ".html": "text/html",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".m4a": "audio/mp4",
  ".webp": "image/webp"
};

function setStrictMime(res, targetUrl, upstreamCT) {
  const ext = path.extname(new URL(targetUrl).pathname).toLowerCase();
  const mime = MIME_BY_EXT[ext];
  if (mime) {
    res.setHeader("Content-Type", mime);
  } else if (upstreamCT) {
    res.setHeader("Content-Type", upstreamCT);
  }
}

// Catch-all: rewrite any root-relative path to /browse/<encoded absolute URL>
app.use(/^\/(?!browse)([^?]*)/, (req, res) => {
  const fullUrl = UPSTREAM_ORIGIN + req.originalUrl;
  res.redirect("/browse/" + encodeURIComponent(fullUrl));
});

// Proxy handler
app.get("/browse/:encoded", async (req, res) => {
  try {
    const target = decodeURIComponent(req.params.encoded);
    const upstream = await fetch(target, {
      headers: { "User-Agent": "Mozilla/5.0 Proxy" }
    });

    // Graceful fallback for upstream errors
    if (!upstream.ok) {
      const ext = path.extname(new URL(target).pathname).toLowerCase();
      if (ext === ".js") {
        res.setHeader("Content-Type", "application/javascript");
        return res.status(200).send("// fallback JS");
      }
      if (ext === ".css") {
        res.setHeader("Content-Type", "text/css");
        return res.status(200).send("/* fallback CSS */");
      }
      return res.status(upstream.status).send("");
    }

    const buf = await upstream.buffer();
    const ct = upstream.headers.get("content-type") || "";
    setStrictMime(res, target, ct);

    res.send(buf);
  } catch (err) {
    console.error("Proxy error:", err);
    res.status(500).send("Proxy error");
  }
});

app.listen(PORT, () => {
  console.log(`Proxy running on http://localhost:${PORT}`);
  console.log(`Upstream origin: ${UPSTREAM_ORIGIN}`);
});
