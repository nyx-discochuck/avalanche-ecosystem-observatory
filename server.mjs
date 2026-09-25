import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { createLivePulseService } from './live-pulse.mjs';
import { createRadarService } from './radar-adapter.mjs';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const DIST = join(ROOT, 'dist');
const DATA = join(ROOT, 'public', 'data');
const PREFIX = '/avalanche/ecosystem';
const PORT = Number(process.env.PORT || 8876);
const HOST = process.env.HOST || '127.0.0.1';
const SEO_ROUTES = {
  '/beginners/': {
    title: 'Avalanche Ecosystem Guide for Beginners | AVAX & DeFi',
    description: 'A plain-language guide to Avalanche, C-Chain, Avalanche L1s, AVAX staking, DeFi, stablecoins, bridges, DEXs, lending, and ecosystem metrics.',
    heading: 'A practical guide to the Avalanche ecosystem',
    copy: 'Learn Avalanche C-Chain, Avalanche L1s, AVAX utility, staking and validation, DeFi, stablecoins, bridges, decentralized exchanges, lending, real-world assets, and how to interpret live ecosystem metrics.',
  },
  '/experts/': {
    title: 'Avalanche Ecosystem Analytics for Advanced Users',
    description: 'Advanced Avalanche analytics for liquidity, DEX volume, stablecoin flows, lending, fees, protocol growth, validators, governance, token unlocks, and L1 activity.',
    heading: 'Avalanche ecosystem analytics for advanced users',
    copy: 'A high-density launchpad for Avalanche liquidity, DEX activity, stablecoins, lending, fees and revenue, validator economics, governance, token emissions, capital flows, L1 activity, and historical trends.',
  },
  '/governance/': { title: 'Avalanche Governance & ACP Tracker', description: 'Track Avalanche Community Proposals, governance discussions, relevant dates, status, official sources, and potential ecosystem impact.', heading: 'Avalanche governance and network-change watch', copy: 'Source-backed Avalanche Community Proposal status, dates, discussion posture, and ecosystem impact with technical coordination clearly separated from token-holder voting.' },
  '/unlocks/': { title: 'Avalanche Token Unlocks & AVAX Emissions', description: 'Source-backed Avalanche token unlock and emissions intelligence with confirmed schedules separated from estimates and protocol staking issuance.', heading: 'Avalanche token unlocks and emissions', copy: 'Confirmed token schedules, estimated events, and observed AVAX protocol emissions are treated as separate evidence classes with sources and timestamps.' },
  '/staking/': { title: 'AVAX Staking Rewards & Avalanche Validator Economics', description: 'Explore AVAX staking reward estimates, Avalanche validator requirements, duration, delegation fees, network parameters, and transparent assumptions.', heading: 'AVAX staking and Avalanche validator economics', copy: 'Current official validator requirements, duration-sensitive AVAX staking estimates, source timestamps, assumptions, and disclosed operating-cost exclusions.' },
  '/verification/': { title: 'Avalanche Metrics Verification & Evidence Ledger', description: 'Review scope-aware Avalanche metric verification checks, comparator sources, tolerances, evidence dates, and explicitly unavailable comparisons.', heading: 'Avalanche metric verification and evidence ledger', copy: 'Inspect the source, scope, tolerance, observation date, and result for each comparator check. Comparator values never overwrite canonical dashboard metrics, and unavailable evidence is shown rather than inferred.' },
  '/tokenized-assets/': { title: 'Avalanche Tokenized Assets, Funds & RWA Evidence', description: 'Track verified native tokenized funds and equity on Avalanche with exact contracts, supply, RedStone valuation provenance, activity coverage, and broader non-additive RWA adapter TVL.', heading: 'Verified tokenized assets issued on Avalanche', copy: 'Review BUIDL, VBILL, ACRED, and SECZ exact-contract supply, valuation basis, source timestamps, activity coverage, issuer evidence, and broader protocol adapter TVL kept in a separate non-additive scope.' },
};
const livePulse = createLivePulseService({
  rpcUrl: process.env.AVALANCHE_RPC_URL,
  sampleSize: process.env.LIVE_PULSE_SAMPLE_SIZE,
  networkTtlMs: process.env.LIVE_PULSE_NETWORK_TTL_MS,
  marketTtlMs: process.env.LIVE_PULSE_MARKET_TTL_MS,
});
const radar = createRadarService({
  baseUrl: process.env.AVAX_RADAR_URL,
  timeoutMs: process.env.AVAX_RADAR_TIMEOUT_MS,
  maxAgeSeconds: process.env.AVAX_RADAR_MAX_AGE_SECONDS,
  activityLimit: process.env.AVAX_RADAR_ACTIVITY_LIMIT,
});

const CONTENT_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.xml': 'application/xml; charset=utf-8',
};

function setSecurityHeaders(response) {
  response.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https://icons.llamao.fi https://coin-images.coingecko.com",
    "connect-src 'self'",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "form-action 'self'",
  ].join('; '));
  response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
}

function sendJson(request, response, status, payload, cache = 'no-store') {
  const body = JSON.stringify(payload);
  const useGzip = body.length > 1024 && /\bgzip\b/.test(request.headers['accept-encoding'] || '');
  const representation = useGzip ? gzipSync(body, { level: 6 }) : Buffer.from(body);
  const etag = `"${createHash('sha256').update(representation).digest('base64url')}"`;
  setSecurityHeaders(response);
  response.setHeader('Cache-Control', cache);
  response.setHeader('Content-Type', CONTENT_TYPES['.json']);
  response.setHeader('ETag', etag);
  response.setHeader('Vary', 'Accept-Encoding');
  if (useGzip) response.setHeader('Content-Encoding', 'gzip');
  if (request.headers['if-none-match'] === etag) {
    response.writeHead(304);
    response.end();
    return;
  }
  response.writeHead(status);
  response.end(request.method === 'HEAD' ? undefined : representation);
}

function publicPath(url) {
  const pathname = new URL(url, 'http://localhost').pathname;
  if (pathname === PREFIX) return '/';
  if (pathname.startsWith(`${PREFIX}/`)) return pathname.slice(PREFIX.length);
  return pathname;
}

function isPrivatePath(url) {
  const rawPath = String(url || '/').split('?')[0];
  let decoded;
  try {
    decoded = decodeURIComponent(rawPath);
  } catch {
    return true;
  }
  const relative = decoded.startsWith(`${PREFIX}/`) ? decoded.slice(PREFIX.length) : decoded;
  const segments = relative.split('/').filter(Boolean);
  const privateRoots = new Set(['state', 'config', 'scripts', 'src', 'test', 'deploy', 'tasks', 'reports', 'node_modules']);
  return segments.some((segment) => segment === '..' || segment.startsWith('.'))
    || privateRoots.has(segments[0])
    || /^package(?:-lock)?\.json$/i.test(segments[0] || '')
    || /\.(?:map|env|ini|log|md|mjs|cjs|jsx|tsx?|ya?ml)$/i.test(segments.at(-1) || '');
}

async function readDashboard() {
  for (const filename of [join(ROOT, 'state', 'dashboard.json'), join(DATA, 'dashboard.json')]) {
    try {
      return JSON.parse(await readFile(filename, 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  throw Object.assign(new Error('No dashboard snapshot'), { code: 'ENOENT' });
}

async function handleApi(request, response, pathname) {
  if (pathname === '/api/radar') {
    if (process.env.AVAX_RADAR_DISABLED === '1') {
      sendJson(request, response, 503, {
        schema: 'couchdicks.avalanche.radar.v1',
        provider: 'avax-radar',
        available: false,
        fresh: false,
        posture: 'disabled',
        failureMode: 'disabled',
        alerts: [],
        heartbeats: [],
      });
      return;
    }
    const payload = await radar.get();
    sendJson(request, response, payload.available ? 200 : 503, payload);
    return;
  }

  if (pathname === '/api/live') {
    if (process.env.LIVE_PULSE_DISABLED === '1') {
      sendJson(request, response, 503, {
        schema: 'couchdicks.avalanche.live-pulse.v2',
        status: 'disabled',
        error: 'live_pulse_disabled',
      });
      return;
    }
    try {
      const payload = await livePulse.get();
      sendJson(request, response, payload.network ? (payload.status === 'live' ? 200 : 207) : 503, payload);
    } catch (error) {
      sendJson(request, response, 503, {
        schema: 'couchdicks.avalanche.live-pulse.v2',
        status: 'unavailable',
        error: 'live_pulse_unavailable',
        detail: String(error?.message || error),
      });
    }
    return;
  }

  if (pathname === '/api/dashboard') {
    try {
      sendJson(request, response, 200, await readDashboard());
    } catch (error) {
      sendJson(request, response, 503, {
        error: 'dashboard_snapshot_unavailable',
        detail: error.code === 'ENOENT' ? 'No successful collector snapshot exists.' : 'The cached snapshot could not be read.',
      });
    }
    return;
  }

  if (pathname === '/api/health' || pathname === '/healthz') {
    try {
      const dashboard = await readDashboard();
      const ageSeconds = Math.max(0, (Date.now() - Date.parse(dashboard.generatedAt)) / 1000);
      const degraded = dashboard.metadata?.freshness !== 'healthy';
      // A readable cached snapshot is a successful health response even when
      // its payload reports degraded upstream freshness. This keeps offline
      // snapshot deployments usable while preserving the degraded signal in
      // the response body.
      sendJson(request, response, 200, {
        status: degraded ? 'degraded' : 'ok',
        generatedAt: dashboard.generatedAt,
        ageSeconds: Math.round(ageSeconds),
        completeThrough: dashboard.metadata?.latestCompleteDate,
        blockNumber: dashboard.status?.blockNumber,
        sourceHealth: dashboard.quality?.sourceHealth,
        verificationSummary: dashboard.quality?.verification?.summary,
        verificationSourceHealth: dashboard.quality?.verificationSourceHealth,
        livePulse: livePulse.peek(),
        radar: radar.peek() ? {
          ...radar.peek(),
          alertCount: radar.peek().alerts.length,
          heartbeatCount: radar.peek().heartbeats.length,
          alerts: undefined,
          heartbeats: undefined,
        } : null,
      });
    } catch {
      sendJson(request, response, 503, { status: 'unavailable' });
    }
    return;
  }

  if (pathname === '/api/catalog') {
    try {
      const [metrics, protocols, sources] = await Promise.all([
        readFile(join(ROOT, 'config', 'metric-catalog.json'), 'utf8'),
        readFile(join(ROOT, 'config', 'protocol-registry.json'), 'utf8'),
        readFile(join(ROOT, 'config', 'sources.json'), 'utf8'),
      ]);
      sendJson(request, response, 200, {
        metrics: JSON.parse(metrics),
        protocols: JSON.parse(protocols),
        sources: JSON.parse(sources),
      }, 'public, max-age=300, must-revalidate');
    } catch {
      sendJson(request, response, 503, { error: 'catalog_unavailable' });
    }
    return;
  }

  sendJson(request, response, 404, { error: 'not_found' });
}

async function sendFile(request, response, filename) {
  const info = await stat(filename);
  if (!info.isFile()) throw Object.assign(new Error('Not a file'), { code: 'ENOENT' });
  const extension = extname(filename).toLowerCase();
  if (extension === '.map') throw Object.assign(new Error('Source maps are not public artifacts'), { code: 'ENOENT' });
  const immutable = filename.includes(`${join('dist', 'assets')}`);
  setSecurityHeaders(response);
  response.setHeader('Content-Type', CONTENT_TYPES[extension] || 'application/octet-stream');
  response.setHeader('Content-Length', info.size);
  response.setHeader('Cache-Control', immutable
    ? 'public, max-age=31536000, immutable'
    : 'public, max-age=0, must-revalidate');
  response.writeHead(200);
  if (request.method === 'HEAD') {
    response.end();
    return;
  }
  createReadStream(filename).pipe(response);
}

async function sendSpaIndex(request, response, pathname) {
  const route = SEO_ROUTES[pathname.endsWith('/') ? pathname : `${pathname}/`];
  if (!route) return sendFile(request, response, join(DIST, 'index.html'));
  let body = await readFile(join(DIST, 'index.html'), 'utf8');
  const canonical = `https://couchdicks.org/avalanche/ecosystem${pathname.endsWith('/') ? pathname : `${pathname}/`}`;
  const structuredData = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Dataset',
    name: route.title,
    description: route.description,
    url: canonical,
    isAccessibleForFree: true,
    creator: { '@type': 'Organization', name: 'Couchdicks' },
    spatialCoverage: 'Avalanche',
  }).replace(/</g, '\\u003c');
  body = body
    .replace(/<title>[^<]*<\/title>/, `<title>${route.title}</title>`)
    .replace(/<meta name="description" content="[^"]*" \/>/, `<meta name="description" content="${route.description}" />`)
    .replace(/<link rel="canonical" href="[^"]*" \/>/, `<link rel="canonical" href="${canonical}" />`)
    .replace(/<meta property="og:title" content="[^"]*" \/>/, `<meta property="og:title" content="${route.title}" />`)
    .replace(/<meta property="og:description" content="[^"]*" \/>/, `<meta property="og:description" content="${route.description}" />`)
    .replace(/<meta property="og:url" content="[^"]*" \/>/, `<meta property="og:url" content="${canonical}" />`)
    .replace(/<script type="application\/ld\+json">.*?<\/script>/, `<script type="application/ld+json">${structuredData}</script>`)
    .replace('<div id="root"></div>', `<div id="root"><main><article><h1>${route.heading}</h1><p>${route.copy}</p><nav><a href="/avalanche/ecosystem/">Avalanche ecosystem overview</a> · <a href="/avalanche/ecosystem/beginners/">Beginner guide</a> · <a href="/avalanche/ecosystem/experts/">Advanced analytics</a> · <a href="/avalanche/ecosystem/staking/">AVAX staking rewards</a> · <a href="/avalanche/ecosystem/governance/">Avalanche governance</a> · <a href="/avalanche/ecosystem/unlocks/">Avalanche token unlocks</a></nav></article></main></div>`);
  setSecurityHeaders(response);
  response.setHeader('Content-Type', CONTENT_TYPES['.html']);
  response.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
  response.writeHead(200);
  response.end(request.method === 'HEAD' ? undefined : body);
}

const server = createServer(async (request, response) => {
  if (!['GET', 'HEAD'].includes(request.method || '')) {
    setSecurityHeaders(response);
    response.setHeader('Allow', 'GET, HEAD');
    response.writeHead(405);
    response.end();
    return;
  }

  if (isPrivatePath(request.url)) {
    sendJson(request, response, 404, { error: 'not_found' });
    return;
  }

  const pathname = publicPath(request.url || '/');
  if (pathname === '/tokenized-assets') {
    setSecurityHeaders(response);
    response.setHeader('Location', `${PREFIX}/tokenized-assets/`);
    response.writeHead(308);
    response.end();
    return;
  }
  if (pathname.startsWith('/api/') || pathname === '/healthz') {
    await handleApi(request, response, pathname);
    return;
  }

  // Only the explicitly published snapshots may bypass the immutable build.
  if (['/data/dashboard.json', '/data/blockspace.json', '/data/tokenized-activity.json'].includes(pathname)) {
    try { await sendFile(request, response, join(DATA, pathname.slice('/data/'.length))); }
    catch { sendJson(request, response, 503, { error: 'published_snapshot_unavailable' }); }
    return;
  }

  if (pathname === '/' || SEO_ROUTES[pathname.endsWith('/') ? pathname : `${pathname}/`]) {
    await sendSpaIndex(request, response, pathname);
    return;
  }
  const requested = pathname.replace(/^\/+/, '');
  const candidate = resolve(DIST, normalize(requested));
  try {
    if (!candidate.startsWith(`${DIST}/`) && candidate !== join(DIST, 'index.html')) {
      throw Object.assign(new Error('Invalid path'), { code: 'ENOENT' });
    }
    await sendFile(request, response, candidate);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      sendJson(request, response, 500, { error: 'internal_error' });
      return;
    }
    try {
      await sendSpaIndex(request, response, pathname);
    } catch {
      sendJson(request, response, 503, {
        error: 'frontend_unavailable',
        detail: 'Run npm run build before starting the production server.',
      });
    }
  }
});

server.listen(PORT, HOST, () => {
  console.log(`avalanche ecosystem dashboard listening on http://${HOST}:${PORT}`);
});

function shutdown() {
  server.close((error) => {
    if (error) {
      console.error(error);
      process.exitCode = 1;
    }
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
