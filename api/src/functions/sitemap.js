/**
 * Universal Azure Static Web Apps (SWA) Function: api/src/functions/sitemap.js
 *
 * Rewritten from `/sitemap.xml` and `/api/sitemap.xml` via `staticwebapp.config.json`.
 * Works automatically for EVERY Azure Static Web App (whether deployed as a Managed
 * Function inside each SWA or as a shared Linked Function App across multiple SWAs)
 * with ZERO hardcoded domain configuration.
 *
 * How SWA Domain Detection Works:
 *   1. Explicit query parameter `?domain=<domain>` or route param `{siteDomain}`
 *   2. `x-ms-original-url` header (injected automatically by Azure Static Web Apps edge proxy
 *      with the exact public URL the visitor/Googlebot requested, e.g. `https://mysite.azurestaticapps.net/sitemap.xml`
 *      or `https://customdomain.com/sitemap.xml`)
 *   3. `x-forwarded-host` / `x-original-host` header
 *   4. `Origin` / `Referer` / `Host` header
 */

import { app } from '@azure/functions';

const BUNBUN_API_BASE = process.env.BUNBUN_API_BASE || 'https://bunbunserver.my.id';

function escapeXml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function cleanHostname(raw) {
  if (!raw) return '';
  let str = String(raw).split(',')[0].trim();
  str = str.replace(/^https?:\/\//i, '').replace(/\/.*$/, '').replace(/:\d+$/, '').toLowerCase();
  if (str.includes('*')) return '';
  return str;
}

/**
 * Resolve the exact public hostname & origin of whichever Azure Static Web App
 * received the `/sitemap.xml` request.
 */
function resolveSwaSiteIdentity(request, routeParams = {}) {
  const reqUrl = new URL(request.url);

  // 1. Check explicit ?domain= or route param {siteDomain}
  const explicitDomain = cleanHostname(routeParams.siteDomain || reqUrl.searchParams.get('domain'));
  if (explicitDomain && explicitDomain !== 'all') {
    return {
      domainParam: explicitDomain,
      siteOrigin: `https://${explicitDomain}`
    };
  }

  // 2. Check Azure SWA's native `x-ms-original-url` header
  const msOriginalUrl = request.headers.get('x-ms-original-url');
  if (msOriginalUrl) {
    try {
      const parsedOrig = new URL(msOriginalUrl);
      const origHost = cleanHostname(parsedOrig.hostname);
      if (origHost && origHost !== 'localhost' && origHost !== '127.0.0.1') {
        return {
          domainParam: reqUrl.searchParams.get('domain') === 'all' ? 'all' : origHost,
          siteOrigin: `${parsedOrig.protocol}//${parsedOrig.host}`
        };
      }
    } catch {}
  }

  // 3. Check `x-forwarded-host` / `x-original-host`
  const forwardedHost = cleanHostname(
    request.headers.get('x-forwarded-host') ||
    request.headers.get('x-original-host') ||
    request.headers.get('x-host')
  );
  if (forwardedHost && forwardedHost !== 'localhost' && forwardedHost !== '127.0.0.1') {
    return {
      domainParam: reqUrl.searchParams.get('domain') === 'all' ? 'all' : forwardedHost,
      siteOrigin: `https://${forwardedHost}`
    };
  }

  // 4. Check `Origin` / `Referer` / `Host`
  const fallbackHost = cleanHostname(
    request.headers.get('origin') ||
    request.headers.get('referer') ||
    request.headers.get('host') ||
    reqUrl.hostname
  );

  const isLocal = !fallbackHost || fallbackHost === 'localhost' || fallbackHost === '127.0.0.1';
  return {
    domainParam: isLocal ? 'all' : fallbackHost,
    siteOrigin: isLocal ? `${reqUrl.protocol}//${reqUrl.host}` : `https://${fallbackHost}`
  };
}

async function handleSwaSitemap(request, context) {
  const reqUrl = new URL(request.url);
  const { domainParam, siteOrigin } = resolveSwaSiteIdentity(request, request.params || {});

  // Also parse query parameters from `x-ms-original-url` if SWA stripped them during rewrite
  let origSearchParams = reqUrl.searchParams;
  const msOrig = request.headers.get('x-ms-original-url');
  if (msOrig) {
    try {
      const parsedMs = new URL(msOrig);
      if (parsedMs.search) {
        origSearchParams = parsedMs.searchParams;
      }
    } catch {}
  }

  const dbParam = (
    origSearchParams.get('db') ||
    origSearchParams.get('category') ||
    reqUrl.searchParams.get('db') ||
    reqUrl.searchParams.get('category') ||
    'all'
  ).trim();

  const rawLimit = parseInt(
    origSearchParams.get('limit') || reqUrl.searchParams.get('limit') || '500',
    10
  );
  const limitParam = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 50000) : 500;

  const upstreamParams = new URLSearchParams({
    domain: domainParam,
    db: dbParam,
    limit: String(limitParam)
  });

  const upstreamUrl = `${BUNBUN_API_BASE}/sitemap.xml?${upstreamParams.toString()}`;

  try {
    const upstreamRes = await fetch(upstreamUrl, {
      method: 'GET',
      headers: {
        Accept: 'application/xml, text/xml, */*',
        Origin: siteOrigin,
        Referer: `${siteOrigin}/`,
        'User-Agent': 'Azure-SWA-Universal-Sitemap/1.1'
      }
    });

    if (upstreamRes.ok) {
      const xmlBody = await upstreamRes.text();
      if (xmlBody && xmlBody.includes('<urlset')) {
        return {
          status: 200,
          headers: {
            'Content-Type': 'application/xml; charset=UTF-8',
            'Cache-Control': 'no-store, must-revalidate',
            'X-Content-Type-Options': 'nosniff',
            'X-SWA-Resolved-Domain': domainParam
          },
          body: xmlBody
        };
      }
    }

    // Fallback Sitemap 0.9 XML builder scoped to this SWA's exact origin
    const fallbackLimit = Math.min(limitParam, 100);
    const randomParams = new URLSearchParams({ limit: String(fallbackLimit) });
    if (dbParam && dbParam !== 'all') {
      randomParams.set('category', dbParam);
    }

    const randomRes = await fetch(`${BUNBUN_API_BASE}/api/articles/random?${randomParams.toString()}`, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Origin: siteOrigin,
        Referer: `${siteOrigin}/`
      }
    });

    const data = randomRes.ok ? await randomRes.json() : { articles: [] };
    const articles = Array.isArray(data.articles) ? data.articles : [];
    const nowIso = new Date().toISOString();

    const entries = [
      `  <url>\n    <loc>${escapeXml(`${siteOrigin}/`)}</loc>\n    <lastmod>${nowIso}</lastmod>\n    <changefreq>daily</changefreq>\n    <priority>1.0</priority>\n  </url>`
    ];

    for (const item of articles) {
      if (!item || !item.category || !item.slug) continue;
      const loc = `${siteOrigin}/?category=${encodeURIComponent(item.category)}&slug=${encodeURIComponent(item.slug)}`;
      const lastMod = item.updatedAt
        ? new Date(Number(item.updatedAt) * 1000).toISOString()
        : nowIso;
      entries.push(
        `  <url>\n    <loc>${escapeXml(loc)}</loc>\n    <lastmod>${escapeXml(lastMod)}</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>0.8</priority>\n  </url>`
      );
    }

    const fallbackXml =
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
      `${entries.join('\n')}\n` +
      `</urlset>`;

    return {
      status: 200,
      headers: {
        'Content-Type': 'application/xml; charset=UTF-8',
        'Cache-Control': 'no-store, must-revalidate',
        'X-Content-Type-Options': 'nosniff',
        'X-SWA-Resolved-Domain': domainParam
      },
      body: fallbackXml
    };
  } catch (err) {
    context.error('SWA Sitemap error:', err);
    const minimalXml =
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
      `  <url>\n    <loc>${escapeXml(`${siteOrigin}/`)}</loc>\n  </url>\n` +
      `</urlset>`;
    return {
      status: 200,
      headers: {
        'Content-Type': 'application/xml; charset=UTF-8',
        'Cache-Control': 'no-store, must-revalidate'
      },
      body: minimalXml
    };
  }
}

// Route 1: /api/sitemap (rewritten from /sitemap.xml and /api/sitemap.xml by staticwebapp.config.json)
app.http('swaSitemap', {
  methods: ['GET', 'HEAD'],
  authLevel: 'anonymous',
  route: 'sitemap/{siteDomain?}',
  handler: handleSwaSitemap
});
