// Fully hardened rewriter: no host leakage, no double-encoding, generalized path handling,
// and safe scoping. Routes everything through /browse/<encoded absolute URL>.

export function rewriteHtml(html, origin, routePrefix = "/browse/") {
  // Encode exactly once to avoid %2F → %252F
  const encOnce = (u) => encodeURIComponent(decodeURIComponent(u));

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

  // Core: turn any URL into an absolute URL against origin, then wrap via /browse/
  const toProxy = (url) => {
    if (!url) return url;
    // Already proxied
    if (url.startsWith(routePrefix)) return url;

    // Absolute http(s)
    if (/^https?:\/\//i.test(url)) return `${routePrefix}${encOnce(url)}`;

    // Protocol-relative //cdn.example.com/...
    if (/^\/\//.test(url)) return `${routePrefix}${encOnce("https:" + url)}`;

    // Root-relative /path
    if (/^\//.test(url)) return `${routePrefix}${encOnce(origin + url)}`;

    // Relative path path/to
    return `${routePrefix}${encOnce(origin + "/" + url)}`;
  };

  // Attribute rewrites: href, src, action
  html = html.replace(/(href|src|action)=["']([^"']+)["']/gi, (_, attr, url) => {
    if (shouldSkip(url)) return `${attr}="${url}"`;
    return `${attr}="${toProxy(url)}"`;
  });

  // Forms: add defaults so submissions stay inside proxy
  html = html.replace(/<form([^>]*)>/gi, (m, attrs) => {
    const hasAction = /action=/i.test(attrs);
    const hasMethod = /method=/i.test(attrs);
    let newAttrs = attrs;
    if (!hasAction) newAttrs += ` action="${routePrefix}${encOnce(origin)}"`;
    if (!hasMethod) newAttrs += ` method="GET"`;
    return `<form${newAttrs}>`;
  });

  // Meta refresh → proxy
  html = html.replace(
    /<meta[^>]+http-equiv=["']refresh["'][^>]+content=["'][^"']*url=([^"']+)["'][^>]*>/gi,
    (_, url) => (shouldSkip(url) ? _ : `<meta http-equiv="refresh" content="0; url=${toProxy(url)}">`)
  );

  // JS redirects → proxy
  html = html.replace(/\bwindow\.location(?:\.href|\s*=)\s*=\s*["']([^"']+)["']/gi,
    (_, url) => (shouldSkip(url) ? _ : `window.location.href="${toProxy(url)}"`));
  html = html.replace(/\blocation\.(assign|replace)\(\s*["']([^"']+)["']\s*\)/gi,
    (_, fn, url) => (shouldSkip(url) ? _ : `location.${fn}("${toProxy(url)}")`));

  // CSS url(...)
  html = html.replace(/url\(["']?([^"')]+)["']?\)/gi, (_, url) => {
    if (shouldSkip(url)) return `url("${url}")`;
    return `url("${toProxy(url)}")`;
  });

  // Inline JS string assets (generalized: any quoted root-relative or absolute http(s))
  html = html.replace(/(["'])(\/[^"']+|https?:\/\/[^"']+)["']/gi, (m, q, url) => {
    if (shouldSkip(url)) return m;
    return `${q}${toProxy(url)}${q}`;
  });

  // Dynamic element .src/.href/.action assignments
  html = html.replace(/\.(src|href|action)\s*=\s*["'](\/[^"']+|https?:\/\/[^"']+)["']/gi,
    (_, attr, url) => `.${attr}="${toProxy(url)}"`);

  // Inject <base> so relative resolution is stable inside the proxied doc
  if (!/\sbase\s/i.test(html)) {
    html = html.replace(/<head[^>]*>/i, (m) => `${m}\n<base href="${routePrefix}${encOnce(origin)}/">`);
  }

  // Runtime navigation patch to intercept pushState, location, window.open
  html = html.replace(/<\/head>/i, (m) => `${navPatch(origin, routePrefix)}\n${m}`);

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

  // Intercept anchor clicks
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

  // Intercept form submits (GET only)
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

  // History and location controls
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
