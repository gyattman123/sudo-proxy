// Hardened rewriter:
// - Encode once (avoid %2F → %252F)
// - Generalize path handling (absolute, protocol-relative, root-relative, relative)
// - Do NOT rewrite inside <script> or <style> to avoid breaking inline JS/CSS
// - Attribute-focused rewrites + CSS url(...) in HTML attributes
// - Runtime patch for navigation, pushState, window.open

export function rewriteHtml(html, origin, routePrefix = "/browse/") {
  const encOnce = (u) => encodeURIComponent(decodeURIComponent(u || ""));

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

    if (/^https?:\/\//i.test(url)) {
      return `${routePrefix}${encOnce(url)}`;
    }
    if (/^\/\//.test(url)) {
      return `${routePrefix}${encOnce("https:" + url)}`;
    }
    if (/^\//.test(url)) {
      return `${routePrefix}${encOnce(origin + url)}`;
    }
    return `${routePrefix}${encOnce(origin + "/" + url)}`;
  };

  // 1) Temporarily extract <script> and <style> blocks to avoid rewriting their internals
  const scriptPlaceholders = [];
  html = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, (m) => {
    const key = `__SCRIPT_BLOCK_${scriptPlaceholders.length}__`;
    scriptPlaceholders.push(m);
    return key;
  });

  const stylePlaceholders = [];
  html = html.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, (m) => {
    const key = `__STYLE_BLOCK_${stylePlaceholders.length}__`;
    stylePlaceholders.push(m);
    return key;
  });

  // 2) Attribute rewrites across the remaining HTML
  html = html.replace(/(href|src|action)=["']([^"']+)["']/gi, (_, attr, url) => {
    if (shouldSkip(url)) return `${attr}="${url}"`;
    return `${attr}="${toProxy(url)}"`;
  });

  // 3) Meta refresh (only in HTML)
  html = html.replace(
    /<meta[^>]+http-equiv=["']refresh["'][^>]+content=["'][^"']*url=([^"']+)["'][^>]*>/gi,
    (_, url) => (shouldSkip(url) ? _ : `<meta http-equiv="refresh" content="0; url=${toProxy(url)}">`)
  );

  // 4) JS redirects in inline event handlers or small snippets (not in full <script> blocks)
  html = html.replace(/\bwindow\.location(?:\.href|\s*=)\s*=\s*["']([^"']+)["']/gi,
    (_, url) => (shouldSkip(url) ? _ : `window.location.href="${toProxy(url)}"`));
  html = html.replace(/\blocation\.(assign|replace)\(\s*["']([^"']+)["']\s*\)/gi,
    (_, fn, url) => (shouldSkip(url) ? _ : `location.${fn}("${toProxy(url)}")`));

  // 5) CSS url(...) occurrences in attributes (e.g., style="background: url(/...)" or inline <link> preloads)
  html = html.replace(/url\(["']?([^"')]+)["']?\)/gi, (_, url) => {
    if (shouldSkip(url)) return `url("${url}")`;
    return `url("${toProxy(url)}")`;
  });

  // 6) Inject <base> so relative resolution is stable inside the proxied doc
  if (!/\sbase\s/i.test(html)) {
    html = html.replace(/<head[^>]*>/i, (m) => `${m}\n<base href="${routePrefix}${encOnce(origin)}/">`);
  }

  // 7) Inject runtime patch for navigation and dynamic URL assignments
  html = html.replace(/<\/head>/i, (m) => `${navPatch(origin, routePrefix)}\n${m}`);

  // 8) Restore <style> and <script> blocks unchanged
  html = html.replace(/__STYLE_BLOCK_(\d+)__/g, (_, i) => stylePlaceholders[Number(i)]);
  html = html.replace(/__SCRIPT_BLOCK_(\d+)__/g, (_, i) => scriptPlaceholders[Number(i)]);

  return html;
}

function navPatch(origin, routePrefix) {
  return `
<script>
(function(){
  const ORIGIN = ${JSON.stringify(origin)};
  const PREFIX = ${JSON.stringify(routePrefix)};
  const encOnce = (u) => encodeURIComponent(decodeURIComponent(u || ""));

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

  // Patch dynamic element assignments without touching inline script source:
  const setAttr = (el, name, value) => {
    try { el.setAttribute(name, wrap(value)); } catch {}
  };
  const originalCreateElement = document.createElement.bind(document);
  document.createElement = function(kind) {
    const el = originalCreateElement(kind);
    try {
      const prox = new Proxy(el, {
        set(target, prop, value) {
          if (prop === "src" || prop === "href" || prop === "action") {
            target[prop] = wrap(value);
            setAttr(target, prop, value);
            return true;
          }
          target[prop] = value;
          return true;
        }
      });
      return prox;
    } catch { return el; }
  };

})();
</script>
`;
}
