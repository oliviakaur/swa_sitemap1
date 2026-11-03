/**
 * Universal Azure Static Web Apps (SWA) Function: api/src/functions/atom.js
 *
 * Rewritten from `/atom.xml`, `/feed.xml`, and `/atom` via `staticwebapp.config.json`.
 * Automatically detects the active SWA domain via `x-ms-original-url` / `x-forwarded-host`
 * and serves RFC 4287 Atom 1.0 XML (`Content-Type: application/atom+xml; charset=UTF-8`).
 */

import { app } from '@azure/functions';

const BUNBUN_API_BASE = process.env.BUNBUN_API_BASE || 'https://bunbunserver.my.id';

function cleanHostname(raw) {
  if (!raw) return '';
  let str = String(raw).split(',')[0].trim();
  str = str.replace(/^https?:\/\//i, '').replace(/\/.*$/, '').replace(/:\d+$/, '').toLowerCase();
  return str.includes('*') ? '' : str;
}

function resolveSwaSiteIdentity(request, routeParams = {}) {
  const reqUrl = new URL(request.url);
  const explicit = cleanHostname(routeParams.siteDomain || reqUrl.searchParams.get('domain'));
  if (explicit && explicit !== 'all') {
    return { domainParam: explicit, siteOrigin: `https://${explicit}` };
  }

  const msOriginalUrl = request.headers.get('x-ms-original-url');
  if (msOriginalUrl) {
    try {
      const parsedOrig = new URL(msOriginalUrl);
      const origHost = cleanHostname(parsedOrig.hostname);
      if (origHost && origHost !== 'localhost' && origHost !== '127.0.0.1') {
        return { domainParam: origHost, siteOrigin: `${parsedOrig.protocol}//${parsedOrig.host}` };
      }
    } catch {}
  }

  const forwardedHost = cleanHostname(
    request.headers.get('x-forwarded-host') ||
    request.headers.get('x-original-host')
  );
  if (forwardedHost && forwardedHost !== 'localhost' && forwardedHost !== '127.0.0.1') {
    return { domainParam: forwardedHost, siteOrigin: `https://${forwardedHost}` };
  }

  return { domainParam: 'all', siteOrigin: `${reqUrl.protocol}//${reqUrl.host}` };
}

async function handleSwaAtom(request) {
  const reqUrl = new URL(request.url);
  const { domainParam, siteOrigin } = resolveSwaSiteIdentity(request, request.params || {});

  const dbParam = (reqUrl.searchParams.get('db') || reqUrl.searchParams.get('category') || 'all').trim();
  const rawLimit = parseInt(reqUrl.searchParams.get('limit') || '100', 10);
  const limitParam = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 5000) : 100;

  const params = new URLSearchParams({
    domain: domainParam,
    db: dbParam,
    limit: String(limitParam)
  });

  try {
    const upstreamRes = await fetch(`${BUNBUN_API_BASE}/atom.xml?${params.toString()}`, {
      method: 'GET',
      headers: {
        Accept: 'application/atom+xml, application/xml, text/xml',
        Origin: siteOrigin,
        Referer: `${siteOrigin}/`
      }
    });
    const body = await upstreamRes.text();
    return {
      status: upstreamRes.ok ? 200 : 502,
      headers: {
        'Content-Type': 'application/atom+xml; charset=UTF-8',
        'Cache-Control': 'no-store, must-revalidate',
        'X-Content-Type-Options': 'nosniff'
      },
      body
    };
  } catch {
    return {
      status: 502,
      headers: {
        'Content-Type': 'application/atom+xml; charset=UTF-8',
        'Cache-Control': 'no-store, must-revalidate'
      },
      body: '<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom"></feed>'
    };
  }
}

app.http('swaAtom', {
  methods: ['GET', 'HEAD'],
  authLevel: 'anonymous',
  route: 'atom/{siteDomain?}',
  handler: handleSwaAtom
});
