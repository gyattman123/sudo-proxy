import express from "express";
import fetch from "node-fetch";

const app = express();
const enc = (url) => encodeURIComponent(url);

// … MIME map and helpers here …

// Explicit login redirect
app.get("/login", (req, res) => {
  res.redirect("/browse/" + enc("https://discord.com/login"));
});

// Asset passthrough
app.get("/assets/*", async (req, res) => {
  // … asset proxy logic …
});

// Main browsing route
app.get("/browse/*", async (req, res) => {
  const target = decodeURIComponent(req.params[0]);
  console.log("Proxying:", target);

  try {
    const upstream = await fetch(target, { /* headers */ });

    // … redirect handling …

    if (ct.includes("text/html")) {
      let html = await upstream.text();
      const origin = new URL(target).origin;

      html = html.replace(
        /(href|src|action)=["']([^"']+)["']/gi,
        (_, attr, url) => {
          if (url.startsWith("/browse/") || url.includes("/browse/https")) return `${attr}="${url}"`;
          if (/^\/assets\/[^"']+$/.test(url)) return `${attr}="/assets/${url.replace(/^\/assets\//, "")}"`;
          if (/^[^\/]*assets\/[^"']+$/.test(url)) {
            const file = url.replace(/^.*assets\//, "");
            return `${attr}="/assets/${file}"`;
          }
          if (/^https?:\/\//.test(url)) return `${attr}="/browse/${enc(url)}"`;
          if (/^\/\/[^/]/.test(url)) return `${attr}="/browse/${enc(`https:${url}`)}"`;
          if (url.toLowerCase().endsWith(".map")) return `${attr}="/browse/${enc(origin)}/${url}"`;
          return `${attr}="/browse/${enc(origin)}/${url}"`;
        }
      );

      // … other rewrites …

      return res.status(upstream.status).send(html);
    }

    // … JSON passthrough, binary handling …

  } catch (err) {
    console.error("Proxy error:", err);
    return res.status(500).send("Proxy error: " + err.message);
  }
});

// Root route
app.get("/", (_, res) => {
  res.send("Proxy is running. Use /browse/<encoded_url>. Assets via /assets/<file>.");
});

const port = process.env.PORT || 8080;
app.listen(port, () => console.log(`Proxy listening on ${port}`));
