export function rewriteHtml(html, origin, routePrefix = "/browse/") {
  const encOnce = (url) => encodeURIComponent(decodeURIComponent(url));

  const shouldSkip = (url) => {
    if (!url) return true;
    const lower = url.toLowerCase();
    return (
      lower.startsWith("#") ||
      lower.startsWith("javascript:") ||
      lower.startsWith("mailto:") ||
      lower.startsWith("tel:") ||
      lower.startsWith("data:")
    );
  };

  const toProxy = (url) => {
    if (!url) return url;
    if (url.startsWith(routePrefix)) return url;
    if (/^https?:\/\//i.test(url)) return `${routePrefix}${encOnce(url)}`;
    if (/^\/\//.test(url)) return `${routePrefix}${encOnce("https:" + url)}`;
    if (/^\//.test(url)) return `${routePrefix}${encOnce(origin + url)}`;
    return `${routePrefix}${encOnce(origin + "/" + url)}`;
  };

  // Rewrite attributes (href, src, action)
  html = html.replace(/(href|src|action)=["']([^"']+)["']/gi, (_, attr, url) => {
    if (shouldSkip(url)) return `${attr}="${url}"`;
    const rewritten = toProxy(url);
    return `${attr}="${rewritten}"`;
  });

  // Form handling
  html = html.replace(/<form([^>]*)>/gi, (m, attrs) => {
    const hasAction = /action=/i.test(attrs);
    const hasMethod = /method=/i.test(attrs);
    let newAttrs = attrs;
    if (!hasAction) newAttrs += ` action="${routePrefix}${encOnce(origin)}"`;
    if (!hasMethod) newAttrs += ` method="GET"`;
    return `<form${newAttrs}>`;
  });

  // Meta refresh
  html = html.replace(
    /<meta[^>]+http-equiv=["']refresh["'][^>]+content=["'][^"']*url=([^"']+)["'][^>]*>/gi,
    (_, url) => shouldSkip(url) ? _ : `<meta http-equiv="refresh" content="0; url=${toProxy(url)}">`
  );

  // JS redirects
  html = html.replace(/\bwindow\.location(?:\.href|\s*=)\s*=\s*["']([^"']+)["']/gi,
    (_, url) => shouldSkip(url) ? _ : `window.location.href="${toProxy(url)}"`);
  html = html.replace(/\blocation\.assign\(\s*["']([^"']+)["']\s*\)/gi,
    (_, url) => shouldSkip(url) ? _ : `location.assign("${toProxy(url)}")`);

  // CSS url(...)
  html = html.replace(/url\(["']?([^"')]+)["']?\)/gi, (_, url) => {
    if (shouldSkip(url)) return `url("${url}")`;
    return `url("${toProxy(url)}")`;
  });

  // Inline JS asset references
  html = html.replace(/["'](\/[^"']+\.(js|css|woff2?|ttf|otf|png|jpg|jpeg|gif|svg|mp4))["']/gi,
    (_, path) => `"${toProxy(path)}"`);

  // Dynamic script injection
  html = html.replace(/\.src\s*=\s*["'](\/[^"']+\.(js|css|woff2?|ttf|otf|mp4))["']/gi,
    (_, path) => `.src="${toProxy(path)}"`);

  // General fallback: rewrite any root-relative path
  html = html.replace(/(["'(])\/([^"'()\s]+)/gi, (_, prefix, rest) => {
    const full = `${origin}/${rest}`;
    return `${prefix}${toProxy(full)}`;
  });

  // Inject <base> if missing
  if (!/\sbase\s/i.test(html)) {
    html = html.replace(/<head[^>]*>/i, m => `${m}\n<base href="${routePrefix}${encOnce(origin)}/">`);
  }

  // Inject runtime patch
  html = html.replace(/<\/head>/i, m => `${navPatch(origin, routePrefix)}\n${m}`);

  return html;
}

function navPatch(origin, routePrefix) {
  return `
<script>
(function(){
  const ORIGIN = ${JSON.stringify(origin)};
  const PREFIX = ${JSON.stringify(routePrefix)};
  const encOnce = (u) => encodeURIComponent(decodeURIComponent(u));

  const shouldSkip = (u) => {
    if (!u) return true;
    const lower = String(u).toLowerCase();
    return lower.startsWith("#") || lower.startsWith("javascript:") ||
           lower.startsWith("mailto:") || lower.startsWith("tel:") || lower.startsWith("data:");
  };
  const wrap = (u) => {
    if (!u || shouldSkip(u)) return u;
    if (String(u).startsWith(PREFIX)) return u;
    if (/^https?:\\/\\//i.test(u)) return PREFIX + encOnce(u);
    if (/^\\/\\//.test(u)) return PREFIX + encOnce("https:" + u);
    if (/^\\//.test(u)) return PREFIX + encOnce(ORIGIN + u);
    return PREFIX + encOnce(ORIGIN + "/" + u);
  };

  document.addEventListener("click", (e) => {
    const a = e.target.closest("a[href]");
    if (!a) return;
    const href = a.getAttribute("href");
    const proxied = wrap(href);
    if (proxied && proxied !== href) {
      e.preventDefault();
      window.location.assign(proxied);
    }
  }, true);

  document.addEventListener("submit", (e) => {
    const f = e.target;
    const action = f.getAttribute("action") || "";
    const proxied = wrap(action || ORIGIN);
    if (proxied && proxied !== action) {
      const method = (f.getAttribute("method") || "GET").toUpperCase();
      if (method === "GET") {
        e.preventDefault();
        window.location.assign(proxied);
      }
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
}
