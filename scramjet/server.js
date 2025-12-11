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
  "set-cookie",
  "strict-transport-security"
];

app.get("/browse/*", async (req, res) => {
  const target = decodeURIComponent(req.params[0]);

  try {
    const upstream = await fetch(target, {
      redirect: "manual",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
      }
    });

    if (String(upstream.status).startsWith("3")) {
      const loc = upstream.headers.get("location");
      if (loc) {
        const absolute = new URL(loc, target).toString();
        return res.redirect("/browse/" + enc(absolute));
      }
      return res.status(upstream.status).end();
    }

    upstream.headers.forEach((v, k) => {
      const lower = k.toLowerCase();
      if (!BLOCKED_HEADERS.includes(lower)) {
        res.setHeader(k, v);
      }
    });

    const ct = upstream.headers.get("content-type") || "";

    if (ct.includes("text/html")) {
      let html = await upstream.text();
      const u = new URL(target);
      const origin = u.origin;

      html = html.replace(
        /(href|src|action)=["']\/(?!\/)([^"']+)["']/gi,
        (_, attr, path) => `${attr}="/browse/${enc(origin)}/${path}"`
      );

      html = html.replace(
        /(href|src|action)=["'](?!https?:\/\/|\/\/|#|mailto:|tel:)([^"']+)["']/gi,
        (_, attr, path) => `${attr}="/browse/${enc(origin)}/${path}"`
      );

      html = html.replace(
        /(href|src|action)=["']\/\/([^"']+)["']/gi,
        (_, attr, rest) => `${attr}="/browse/${enc(`https://${rest}`)}"`
      );

      html = html.replace(
        /(href|src|action)=["'](https?:\/\/[^"']+)["']/gi,
        (_, attr, url) => {
          if (url.startsWith("/browse/")) return `${attr}="${url}"`;
          return `${attr}="/browse/${enc(url)}"`;
        }
      );

      html = html
        .replace(/fetch\(\s*["']\/(?!\/)/gi, `fetch("/browse/${enc(origin)}/`)
        .replace(/(xhr\.open\(\s*["']GET["']\s*,\s*["'])\/(?!\/)/gi, `$1/browse/${enc(origin)}/`)
        .replace(/(xhr\.open\(\s*["']POST["']\s*,\s*["'])\/(?!\/)/gi, `$1/browse/${enc(origin)}/`);

      html = html.replace(
        /(window\.location(?:\.href|\.assign|\.replace)\s*=\s*["'])(https?:\/\/[^"']+)["']/gi,
        (_, prefix, url) => {
          if (url.startsWith("/browse/")) return `${prefix}${url}"`;
          return `${prefix}/browse/${enc(url)}"`;
        }
      );

      res.status(upstream.status).send(html);
      return;
    }

    if (ct.includes("application/json")) {
      const json = await upstream.text();
      res.status(upstream.status).send(json);
      return;
    }

    const buffer = Buffer.from(await upstream.arrayBuffer());

    // Fix MIME type for .js files
    if (target.endsWith(".js")) {
      res.setHeader("Content-Type", "application/javascript");
    }

    res.status(upstream.status).end(buffer);

  } catch (err) {
    res.status(500).send("Proxy error: " + err.message);
  }
});

app.get("/", (_, res) => {
  res.send('Scramjet proxy is running. Use /browse/<encoded_url>.');
});

const port = process.env.PORT || 8080;
app.listen(port, () => console.log(`Scramjet proxy on ${port}`));
