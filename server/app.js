// HTTP-Server: liefert die Web-App aus und stellt die JSON-API unter /api/ bereit.

import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RateLimiter } from './cache.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PUBLIC_DIR = path.join(ROOT, 'public');
const SHARED_DIR = path.join(ROOT, 'shared');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': [
    "default-src 'self'", "img-src 'self' data:", "style-src 'self'", "script-src 'self'",
    "connect-src 'self'", "manifest-src 'self'", "worker-src 'self'", "base-uri 'none'",
    "form-action 'self'", "frame-ancestors 'none'",
  ].join('; '),
};

function sendJson(res, status, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    'Content-Type': MIME['.json'],
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    ...extraHeaders,
  });
  res.end(body);
}

function sendError(res, status, message, extraHeaders) {
  sendJson(res, status, { error: { message } }, extraHeaders);
}

function resolveStatic(pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  const [baseDir, rel] = decoded.startsWith('/shared/')
    ? [SHARED_DIR, decoded.slice('/shared/'.length)]
    : [PUBLIC_DIR, decoded === '/' ? 'index.html' : decoded.slice(1)];
  const file = path.resolve(baseDir, rel);
  return file.startsWith(baseDir + path.sep) ? file : null;
}

async function serveStatic(req, res, pathname) {
  const file = resolveStatic(pathname);
  const info = file ? await stat(file).catch(() => null) : null;
  if (!info?.isFile()) return sendError(res, 404, 'Nicht gefunden.');

  const etag = `W/"${info.size.toString(16)}-${Math.floor(info.mtimeMs).toString(16)}"`;
  const headers = {
    ...SECURITY_HEADERS,
    'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream',
    'Cache-Control': 'no-cache',
    ETag: etag,
  };
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, headers);
    return res.end();
  }
  res.writeHead(200, { ...headers, 'Content-Length': info.size });
  if (req.method === 'HEAD') return res.end();
  createReadStream(file).pipe(res);
}

function clientIp(req, trustProxy) {
  if (trustProxy) {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded) return forwarded.split(',')[0].trim();
  }
  return req.socket.remoteAddress ?? 'unknown';
}

export function createApp({ config, service, logger = console }) {
  const limiter = new RateLimiter({ limit: config.rateLimitPerMinute });

  async function handleApi(req, res, url) {
    switch (url.pathname) {
      case '/api/info':
        return sendJson(res, 200, service.info());

      case '/api/detect': {
        const number = url.searchParams.get('number');
        if (!number) return sendError(res, 400, 'Parameter „number“ fehlt.');
        return sendJson(res, 200, service.detect(number));
      }

      case '/api/track': {
        const number = url.searchParams.get('number');
        if (!number) return sendError(res, 400, 'Parameter „number“ fehlt.');
        if (!limiter.allow(clientIp(req, config.trustProxy))) {
          return sendError(res, 429, 'Zu viele Abfragen – bitte eine Minute warten.', { 'Retry-After': '60' });
        }
        const result = await service.track(number, {
          carrierId: url.searchParams.get('carrier') || null,
          force: url.searchParams.get('force') === '1',
        });
        return sendJson(res, 200, result);
      }

      default:
        return sendError(res, 404, 'Unbekannter API-Endpunkt.');
    }
  }

  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        return sendError(res, 405, 'Methode nicht erlaubt.', { Allow: 'GET, HEAD' });
      }
      if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
      return await serveStatic(req, res, url.pathname);
    } catch (err) {
      if (err?.status && err.status < 500) return sendError(res, err.status, err.message);
      if (err?.name === 'ProviderError') return sendError(res, err.status ?? 502, err.message);
      logger.error(err);
      if (!res.headersSent) sendError(res, 500, 'Interner Fehler.');
      else res.destroy();
    }
  });
}
