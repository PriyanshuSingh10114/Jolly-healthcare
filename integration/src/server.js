import { createServer } from 'node:http';
import { creator, ZohoError } from './zoho.js';
import { catalog, InputError, submit, validate } from './rfq.js';

export function server(db, origin) {
  const buckets = new Map();
  let catalogCache;
  return createServer({ requestTimeout: 12000 }, async (req, res) => {
    const reply = (status, data) => {
      if (!res.destroyed) {
        res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff' });
        res.end(data === undefined ? undefined : JSON.stringify(data));
      }
    };
    if (req.url === '/healthz' && req.method === 'GET') return reply(200, { ok: true });
    if (req.headers.origin !== origin) return reply(403, { error: 'Origin denied.' });
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    if (!['/catalog', '/rfq'].includes(req.url)) return reply(404, { error: 'Unknown route.' });
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods', req.url === '/rfq' ? 'POST' : 'GET');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      return reply(204);
    }
    if (!(req.url === '/catalog' && req.method === 'GET') &&
        !(req.url === '/rfq' && req.method === 'POST')) {
      return reply(405, { error: 'Method denied.' });
    }
    const now = Date.now();
    for (const [key, bucket] of buckets) if (bucket.until <= now) buckets.delete(key);
    const key = req.socket.remoteAddress;
    if (!buckets.has(key) && buckets.size >= 10000) return reply(429, { error: 'Try again shortly.' });
    const bucket = buckets.get(key) ?? { until: now + 60000, catalog: 0, rfq: 0 };
    buckets.set(key, bucket);
    const route = req.url.slice(1);
    if (++bucket[route] > (route === 'rfq' ? 6 : 60)) {
      res.setHeader('Retry-After', '60');
      return reply(429, { error: 'Too many requests. Try again in one minute.' });
    }
    try {
      if (route === 'catalog') {
        if (!catalogCache || catalogCache.until <= now) {
          catalogCache = { until: now + 15000, value: catalog(db) };
        }
        return reply(200, { items: await catalogCache.value });
      }
      if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] ?? '')) {
        return reply(415, { error: 'Send JSON.' });
      }
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 4096) {
          res.setHeader('Connection', 'close');
          reply(413, { error: 'Request too large.' });
          return;
        }
        chunks.push(chunk);
      }
      let data;
      try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch { throw new InputError('Invalid request.'); }
      await submit(db, validate(data));
      return reply(200, { ok: true });
    } catch (error) {
      if (error instanceof InputError) return reply(400, { error: error.message });
      if (route === 'catalog') catalogCache = undefined;
      console.error(JSON.stringify({ route, operation: error instanceof ZohoError ? error.message : 'request',
        status: error instanceof ZohoError ? error.status : undefined,
        code: error instanceof ZohoError ? error.code : undefined }));
      return reply(503, { error: 'Service temporarily unavailable. Please try again.' });
    }
  });
}

if (import.meta.main ?? process.argv[1]?.endsWith('server.js')) {
  const url = new URL(process.env.STOREFRONT_ORIGIN);
  if (url.protocol !== 'https:' || url.href !== url.origin + '/') throw new Error('Set an HTTPS storefront origin.');
  server(creator(), url.origin).listen(Number(process.env.PORT || 8080), '0.0.0.0');
}

