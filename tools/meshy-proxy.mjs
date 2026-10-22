#!/usr/bin/env node
/**
 * FORM//ENGINE — optional, user-run Meshy proxy (zero dependencies, Node ≥ 20).
 *
 *   MESHY_API_KEY=msy_... ALLOW_ORIGIN=http://127.0.0.1:5180 node tools/meshy-proxy.mjs
 *
 * • Holds YOUR key server-side; the browser never sees it.
 * • Forwards ONLY the four Meshy routes FORM//ENGINE uses:
 *     POST /openapi/v1/image-to-3d            POST /openapi/v1/multi-image-to-3d
 *     GET  /openapi/v1/image-to-3d/:id         GET  /openapi/v1/multi-image-to-3d/:id
 *   plus GET /asset?u=<signed assets.meshy.ai URL> to download the GLB without CORS issues.
 * • CORS is limited to ALLOW_ORIGIN. Body size capped at 90 MB (4 × 20 MB images as base64).
 * • Every create call costs Meshy credits on your account.
 */
import http from 'node:http';

const KEY = process.env.MESHY_API_KEY;
const ORIGIN = process.env.ALLOW_ORIGIN ?? 'http://127.0.0.1:5180';
const PORT = +(process.env.PORT ?? 8787);
const UPSTREAM = 'https://api.meshy.ai';
if (!KEY) { console.error('Set MESHY_API_KEY in the environment.'); process.exit(1); }

const routes = [
  { method: 'POST', re: /^\/openapi\/v1\/(image-to-3d|multi-image-to-3d)$/ },
  { method: 'GET', re: /^\/openapi\/v1\/(image-to-3d|multi-image-to-3d)\/[A-Za-z0-9-]+$/ },
];

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Vary', 'Origin');
}

http.createServer(async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') { res.writeHead(204).end(); return; }
  const url = new URL(req.url, 'http://x');
  try {
    if (req.method === 'GET' && url.pathname === '/asset') {
      const u = new URL(url.searchParams.get('u') ?? '');
      if (u.protocol !== 'https:' || !/(^|\.)meshy\.ai$/.test(u.hostname)) { res.writeHead(400).end('asset host not allowed'); return; }
      const r = await fetch(u); res.writeHead(r.status, { 'Content-Type': r.headers.get('content-type') ?? 'application/octet-stream' });
      res.end(Buffer.from(await r.arrayBuffer())); return;
    }
    if (!routes.some(r => r.method === req.method && r.re.test(url.pathname))) { res.writeHead(404).end('route not proxied'); return; }
    let body;
    if (req.method === 'POST') {
      const chunks = []; let n = 0;
      for await (const c of req) { n += c.length; if (n > 90 * 1024 * 1024) { res.writeHead(413).end('too large'); return; } chunks.push(c); }
      body = Buffer.concat(chunks);
    }
    const r = await fetch(UPSTREAM + url.pathname, { method: req.method, headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }, body });
    res.writeHead(r.status, { 'Content-Type': 'application/json' });
    res.end(Buffer.from(await r.arrayBuffer()));
  } catch (e) { res.writeHead(502).end(String(e?.message ?? e)); }
}).listen(PORT, '127.0.0.1', () => console.log(`meshy proxy on http://127.0.0.1:${PORT} (CORS: ${ORIGIN})`));
