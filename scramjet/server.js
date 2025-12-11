import express from "express";
import fetch from "node-fetch";

const app = express();

app.get("/browse/*", async (req, res) => {
  const target = decodeURIComponent(req.params[0]);

  try {
    const upstream = await fetch(target, {
      redirect: "manual",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
      }
    });

    // Handle redirects
    if (String(upstream.status).startsWith("3")) {
      const loc = upstream.headers.get("location");
      const absolute = new URL(loc, target).toString();
      return res.redirect("/browse/" + encodeURIComponent(absolute));
    }

    const ct = upstream.headers.get("content-type") || "";

    // Copy headers but strip problematic ones
    const blocked = [
      "content-encoding",
      "content-length",
      "transfer-encoding",
      "content-security-policy",
      "x-frame-options",
      "set-cookie",
      "strict-transport-security"
    ];
    upstream.headers.forEach((v, k) => {
      if (!blocked.includes(k.toLowerCase())) {
        res.setHeader(k, v);
      }
    });

    if (ct.includes("text/html")) {
      let text = await upstream.text();
      const base = new URL(target).origin;

      // Rewrite relative href/src
      text = text.replace(/href="\//g, `href="/browse/${encodeURIComponent(base)}/`);
      text = text.replace(/src="\//g, `src="/browse/${encodeURIComponent(base)}/`);

      // Rewrite API calls (/api/...)
      text = text.replace(/fetch\("\/api\//g, `fetch("/browse/${encodeURIComponent(base)}/api/`);
      text = text.replace(/xhr\.open\("GET", "\/api\//g, `xhr.open("GET", "/browse/${encodeURIComponent(base)}/api/`);

      // Rewrite absolute links (example.com/look → proxied)
      text = text.replace(/https?:\/\/([a-zA-Z0-9.-]+)(\/[^\s"']*)?/g, (match) => {
        try {
          const u = new URL(match);
          return `/browse/${encodeURIComponent(u.origin + (u.pathname || ""))}`;
        } catch {
          return match;
        }
      });

      res.status(upstream.status).send(text);

    } else if (ct.includes("application/json")) {
      // JSON API responses → pass through unchanged
      const json = await upstream.text();
      res.status(upstream.status).send(json);

    } else {
      // Binary or other content → buffer
      const buffer = Buffer.from(await upstream.arrayBuffer());
      res.status(upstream.status).end(buffer);
    }

  } catch (err) {
    res.status(500).send("Proxy error: " + err.message);
  }
});

const port = process.env.PORT || 8080;
app.listen(port, () => console.log(`Scramjet proxy on ${port}`));
