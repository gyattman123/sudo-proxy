import express from "express";
import fetch from "node-fetch";

const app = express();

app.get("/browse/*", async (req, res) => {
  const target = decodeURIComponent(req.params[0]);

  try {
    const upstream = await fetch(target, { redirect: "manual" });

    // Handle redirects
    if (String(upstream.status).startsWith("3")) {
      const loc = upstream.headers.get("location");
      const absolute = new URL(loc, target).toString();
      return res.redirect("/browse/" + encodeURIComponent(absolute));
    }

    // Copy headers but strip problematic ones
    upstream.headers.forEach((v, k) => {
      const lower = k.toLowerCase();
      if (
        lower !== "content-encoding" &&
        lower !== "content-length" &&
        lower !== "transfer-encoding"
      ) {
        res.setHeader(k, v);
      }
    });

    // Buffer the body safely
    const buffer = Buffer.from(await upstream.arrayBuffer());
    res.status(upstream.status).end(buffer);

  } catch (err) {
    res.status(500).send("Proxy error: " + err.message);
  }
});

const port = process.env.PORT || 8080;
app.listen(port, () => console.log(`Scramjet proxy on ${port}`));
