/**
 * 星屿乐园本地服务：静态页 + 与线上相同的 /api。
 * 用法：node server.mjs
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleApi } from './lib/park-api.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
const PORT = Number(process.env.PORT || 8787);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

const PAGES = {
  '/app': '/pages/app-v2.html',
  '/admin': '/pages/admin-v2.html'
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, headers);
  res.end(body);
}

function safeJoin(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0]);
  const rel = PAGES[decoded] || (decoded === '/' ? '/index.html' : decoded);
  const abs = path.normalize(path.join(ROOT, rel));
  if (!abs.startsWith(ROOT)) return null;
  return abs;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://127.0.0.1:${PORT}`);
    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url, ROOT);
      return;
    }
    let filePath = safeJoin(url.pathname);
    if (!filePath) return send(res, 403, 'forbidden', { 'Content-Type': 'text/plain; charset=utf-8' });
    if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
      filePath = path.join(filePath, 'index.html');
    }
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      return send(res, 404, 'Not found', { 'Content-Type': 'text/plain; charset=utf-8' });
    }
    const ext = path.extname(filePath).toLowerCase();
    send(res, 200, fs.readFileSync(filePath), { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  } catch (err) {
    if (!res.headersSent) send(res, 500, JSON.stringify({ message: err.message || 'server error' }), { 'Content-Type': 'application/json; charset=utf-8' });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`星屿乐园已启动：http://127.0.0.1:${PORT}`);
  console.log(`App  http://127.0.0.1:${PORT}/app`);
  console.log(`后台 http://127.0.0.1:${PORT}/admin`);
});
