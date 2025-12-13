import express from "express";
import fetch from "node-fetch";

const app = express();
const enc = (url) => encodeURIComponent(url);

const parseCookies = (cookieHeader = "") =>
  cookieHeader.split(";").map(v => v.trim()).filter(Boolean).reduce((acc, pair) => {
    const eq = pair.indexOf("=");
    if (eq > -1) acc[pair.slice(0, eq)] = pair.slice(eq + 1);
    return acc;
  }, {});

const BLOCKED_HEADERS = [
  "content-encoding","content-length","transfer-encoding",
  "content-security-policy","x-frame-options","strict-transport-security"
];

const MIME_BY_EXT = (path) => {
  const p = path.toLowerCase();
  if (p.endsWith(".js")||p.endsWith(".mjs")||p.endsWith(".cjs")||p.endsWith(".jsx")) return "application/javascript";
  if (p.endsWith(".ts")||p.endsWith(".tsx")) return "application/typescript";
  if (p.endsWith(".css")) return "text/css";
  if (p.endsWith(".html")||p.endsWith(".htm")) return "text/html";
  if (p.endsWith(".json")||p.endsWith(".map")) return "application/json";
  if (p.endsWith(".png")) return "image/png";
  if (p.endsWith(".jpg")||p.endsWith(".jpeg")) return "image/jpeg";
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

const EXECUTABLE_OR_RENDERED = [".js",".mjs",".cjs",".jsx",".ts",".tsx",".css",".map",".wasm",".woff",".woff2"];
const isExecutableOrRendered404 = (path) => EXECUTABLE_OR_RENDERED.some(ext => path.toLowerCase().endsWith(ext));

const setStrictMimeIfNeeded = (res, url, ct) => {
  const mime = MIME_BY_EXT(url);
  if (!ct || ct === "application/octet-stream" || ct === "text/html") {
    if (mime) res.setHeader("Content-Type", mime);
  }
  if (url.toLowerCase().endsWith(".wasm")) res.setHeader("Content-Type", "application/wasm");
};

app.use((req, res, next) => {
  const path = req.path || "/";
  if (path === "/" || path.startsWith("/browse/")) return next();
  const cookies = parseCookies(req.headers.cookie || "");
  const ctxOrigin = cookies.ctx_origin;
  if (ctxOrigin) {
    const target = `${ctxOrigin}${req.originalUrl}`;
    return res.redirect(302, `/browse/${enc(target)}`);
  }
  next();
});

const navPatch = (origin) => `
<script>
(function(){
  const ORIGIN = ${JSON.stringify(origin)};
  const enc = encodeURIComponent;
  const wrap = (u) => {
    if (!u) return u;
    if (/^https?:\\/\\/discord\\.com\\//i.test(u)) return "/browse/" + enc(u);
    if (/^\\/\\//.test(u)) return "/browse/" + enc("https:" + u);
    if (/^\\//.test(u)) return "/browse/" + enc(ORIGIN + u);
    if (/^\\/browse\\//.test(u)) return u;
    return "/browse/" + enc(ORIGIN + "/" + u);
  };
  document.addEventListener("click", e=>{
    const a = e.target.closest("a[href]");
    if (!a) return;
    const href = a.getAttribute("href");
    const proxied = wrap(href);
    if (proxied && proxied !== href) {
      e.preventDefault();
      window.location.assign(proxied);
    }
  }, true);
  document.addEventListener("submit", e=>{
    const f = e.target;
    const action = f.getAttribute("action") || "/";
    const proxied = wrap(action);
    if (proxied && proxied !== action) {
      e.preventDefault();
      window.location.assign(proxied);
    }
  }, true);
  const _push = history.pushState, _replace = history.replaceState;
  history.pushState = function(s,t,u){ return _push.call(this,s,t,wrap(u)); };
  history.replaceState = function(s,t,u){ return _replace.call(this,s,t,wrap(u)); };
  const L = window.location, _assign = L.assign.bind(L), _replaceLoc = L.replace.bind(L);
  Object.defineProperty(window,"location",{get(){return L;},set(u){_assign(wrap(u));}});
  L.assign = (u)=>_assign(wrap(u));
  L.replace = (u)=>_replaceLoc(wrap(u));
  const _open = window.open;
  window.open = (u,n,s)=>_open.call(window,wrap(u),n,s);
})();
</script>
`;

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
    res.cookie?.("ctx_origin", origin, { httpOnly:false, sameSite:"Lax", path:"/" });

    if (ct.includes("text/html")) {
      let html = await upstream.text();

      // Rewrite attributes
      html = html.replace(/(href|src|action)=["']([^"']+)["']/gi,(_,attr,url)=>{
        if (url.startsWith("/browse/")) return `${attr}="${url}"`;
        if (/^https?:\/\/discord\.com/i.test(url)) return `${attr}="/browse/${enc(url)}"`;
        if (/^https?:\/\//i.test(url)) return `${attr}="/browse/${enc(url)}"`;
        if (/^\/\//.test(url)) return `${attr}="/browse/${enc("https:"+url)}"`;
        if (/^\//.test(url)) return `${attr}="/browse/${enc(origin+url)}"`;
        return `${attr}="/browse/${enc(origin+"/"+url)}"`;
      });

      // Meta refresh redirects
      html = html.replace(/<meta[^>]+http-equiv=["']refresh["'][^>]+content=["'][^"']*url=([^"']+)["'][^>]*>/gi,
        (_, url) => `<meta http-equiv="refresh" content="0; url=/browse/${enc(url)}">`);

      // JS absolute redirects
      html = html.replace(/window\.location\.href\s*=\s*["']https:\/\/([^"']+)["']/gi,
        (_, path) => `window.location.href="/browse/${enc("https://"+path)}"`);

      // Fetch/xhr rewrites
      html = html
        .replace(/fetch\(\s*["']\/(?!\/)/gi, `fetch("/browse/${enc(origin)}/`)
        .replace(/(xhr\.open\(\s*["'](GET|POST|PUT|PATCH|DELETE)["']\s*,\s*["'])\/(?!\/)/gi, `$1/browse/${enc(origin)}/`);

      if (!/\sbase\s/i.test(html)) {
        html = html.replace(/<head[^>]*>/i, m => `${m}\n<base href="/browse/${enc(origin)}/">`);
      }
      html = html.replace(/<\/head>/i, m => `${navPatch(origin)}\n${m}`);
      return res.status(upstream.status).send(html);
    }

    if
