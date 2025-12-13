export function rewriteHtml(html, origin, routePrefix = "/browse/") {
  const enc = encodeURIComponent;

  // Rewrite attributes (href, src, action)
  html = html.replace(/(href|src|action)=["']([^"']+)["']/gi, (_, attr, url) => {
    if (url.startsWith(routePrefix)) return `${attr}="${url}"`;
    if (/^https?:\/\//i.test(url)) return `${attr}="${routePrefix}${enc(url)}"`;
    if (/^\/\//.test(url)) return `${attr}="${routePrefix}${enc("https:" + url)}"`;
    if (/^\//.test(url)) return `${attr}="${routePrefix}${enc(origin + url)}"`;
    return `${attr}="${routePrefix}${enc(origin + "/" + url)}"`;
  });

  // Meta refresh redirects
  html = html.replace(
    /<meta[^>]+http-equiv=["']refresh["'][^>]+content=["'][^"']*url=([^"']+)["'][^>]*>/gi,
    (_, url) => `<meta http-equiv="refresh" content="0; url=${routePrefix}${enc(url)}">`
  );

  // JS absolute redirects
  html = html.replace(
    /window\.location\.href\s*=\s*["']https:\/\/([^"']+)["']/gi,
    (_, path) => `window.location.href="${routePrefix}${enc("https://" + path)}"`
  );

  // CSS url(...) references
  html = html.replace(/url\(["']?([^"')]+)["']?\)/gi, (_, url) => {
    if (/^https?:\/\//i.test(url)) {
      return `url("${routePrefix}${enc(url)}")`;
    }
    if (/^\//.test(url)) {
      return `url("${routePrefix}${enc(origin + url)}")`;
    }
    return `url("${routePrefix}${enc(origin + "/" + url)}")`;
  });

  // Inject <base> if missing
  if (!/\sbase\s/i.test(html)) {
    html = html.replace(/<head[^>]*>/i, m => `${m}\n<base href="${routePrefix}${enc(origin)}/">`);
  }

  // Inject runtime navigation patch
  html = html.replace(/<\/head>/i, m => `${navPatch(origin, routePrefix)}\n${m}`);

  return html;
}

// Runtime navigation patch script
function navPatch(origin, routePrefix) {
  return `
<script>
(function(){
  const ORIGIN = ${JSON.stringify(origin)};
  const PREFIX = ${JSON.stringify(routePrefix)};
  const enc = encodeURIComponent;
  const wrap = (u) => {
    if (!u) return u;
    if (/^https?:\\/\\//i.test(u)) return PREFIX + enc(u);
    if (/^\\/\\//.test(u)) return PREFIX + enc("https:" + u);
    if (/^\\//.test(u)) return PREFIX + enc(ORIGIN + u);
    if (u.startsWith(PREFIX)) return u;
    return PREFIX + enc(ORIGIN + "/" + u);
  };
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
