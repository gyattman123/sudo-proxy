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
    if (/^https?:\/\//i.test(url)) return `${routePrefix}${encOnce(url)}`;
    if (/^\/\//.test(url)) return `${routePrefix}${encOnce("https:" + url)}`;
    if (/^\//.test(url)) return `${routePrefix}${encOnce(origin + url)}`;
    return `${routePrefix}${encOnce(origin + "/" + url)}`;
  };

  // Rewrite common attributes
  html = html.replace(/(href|src|action|data-src)=["']([^"']+)["']/gi, (_, attr, url) => {
    if (shouldSkip(url)) return `${attr}="${url}"`;
    return `${attr}="${toProxy(url)}"`;
  });

  // Rewrite srcset
  html = html.replace(/srcset=["']([^"']+)["']/gi, (_, val) => {
    const rewritten = val
      .split(",")
      .map((part) => {
        const [u, size] = part.trim().split(/\s+/);
        const proxied = shouldSkip(u) ? u : toProxy(u);
        return size ? `${proxied} ${size}` : proxied;
      })
      .join(", ");
    return `srcset="${rewritten}"`;
  });

  // Rewrite preload links
  html = html.replace(
    /<link([^>]*?)rel=["']preload["']([^>]*?)href=["']([^"']+)["']([^>]*)>/gi,
    (m, a1, a2, url, a3) => `<link${a1}rel="preload"${a2}href="${toProxy(url)}"${a3}>`
  );

  // Rewrite meta refresh
  html = html.replace(
    /<meta[^>]+http-equiv=["']refresh["'][^>]+content=["'][^"']*url=([^"']+)["'][^>]*>/gi,
    (_, url) => (shouldSkip(url) ? _ : `<meta http-equiv="refresh" content="0; url=${toProxy(url)}">`)
  );

  // Rewrite CSS url(...)
  html = html.replace(/url\(["']?([^"')]+)["']?\)/gi, (_, url) => {
    if (shouldSkip(url)) return `url("${url}")`;
    return `url("${toProxy(url)}")`;
  });

  // Rewrite inline JSON/config blobs
  html = html.replace(
    /(["'])(\/[^"']+\.(js|css|woff2?|ttf|otf|png|jpg|jpeg|gif|svg|mp4|webp|json)|https?:\/\/[^"']+)(["'])/gi,
    (m, open, url, _ext, close) => {
      if (shouldSkip(url)) return m;
      return `${open}${toProxy(url)}${close}`;
    }
  );

  // Inject <base> if missing
  if (!/\sbase\s/i.test(html)) {
    html = html.replace(/<head[^>]*>/i, (m) => `${m}\n<base href="${routePrefix}${encOnce(origin)}/">`);
  }

  // Inject runtime patch
  html = html.replace(/<\/head>/i, (m) => `${navPatch(routePrefix)}\n${m}`);

  return html;
}
