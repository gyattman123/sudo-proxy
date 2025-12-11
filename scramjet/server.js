import express from "express";
import fetch from "node-fetch";

const app = express();

app.get("/browse/:encoded", async (req, res) => {
  const target = decodeURIComponent(req.params.encoded);
  const upstream = await fetch(target, { redirect: "manual" });

  if (String(upstream.status).startsWith("3")) {
    const loc = upstream.headers.get("location");
    return res.redirect("/browse/" + encodeURIComponent(new URL(loc, target).toString()));
  }

  res.status(upstream.status);
  upstream.headers.forEach((v, k) => res.setHeader(k, v));
  upstream.body.pipe(res);
});

const port = process.env.PORT || 8080;
app.listen(port, () => console.log(`Scramjet proxy on ${port}`));

