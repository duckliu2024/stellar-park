/**
 * 星屿乐园 BFF：浏览器只打本机接口，Vectoree 密钥留在服务器。
 * 用法：node server.mjs
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
const PORT = Number(process.env.PORT || 8787);
const VECTOREE_API = (process.env.VECTOREE_API_URL || 'https://vectoree.ai').replace(/\/$/, '');
const TABLE = 'park_orders';

function loadApiKey() {
  if (process.env.VECTOREE_API_KEY) return process.env.VECTOREE_API_KEY;
  const cfgPath = path.join(ROOT, '.vectoree', 'config.json');
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  if (!cfg.apiKey) throw new Error('missing VECTOREE_API_KEY');
  return cfg.apiKey;
}

const API_KEY = loadApiKey();

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
};

function send(res, status, body, headers = {}) {
  const payload = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': headers['Content-Type'] || 'application/json; charset=utf-8',
    ...headers
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 2_000_000) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function vectoree(pathname, { method = 'GET', body, token, query, extraHeaders } = {}) {
  const url = new URL(VECTOREE_API + pathname);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v != null && v !== '') url.searchParams.set(k, String(v));
    }
  }
  const headers = {
    Authorization: 'Bearer ' + (token || API_KEY),
    ...(extraHeaders || {})
  };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { message: text }; }
  return { ok: res.ok, status: res.status, data, text };
}

async function requireAppUser(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return { error: { status: 401, body: { message: '请先登录' } } };
  const session = await vectoree('/api/auth/sessions/current', { token });
  if (!session.ok || !session.data?.user?.id) {
    return { error: { status: 401, body: session.data || { message: '登录已过期' } } };
  }
  return { user: session.data.user, token };
}

function rowToOrder(row) {
  const payload = row.payload && typeof row.payload === 'object' ? row.payload : {};
  return {
    ...payload,
    id: payload.id || row.order_no || row.orderNo,
    userId: row.user_id || row.userId,
    email: row.email || payload.email,
    buyer: row.buyer || payload.buyer,
    status: row.status || payload.status,
    orderType: row.kind === 'express' || payload.ticketId === 'express' ? 'express' : payload.orderType
  };
}

function orderToRow(user, order) {
  const kind = order.ticketId === 'express' || order.orderType === 'express' ? 'express' : 'ticket';
  return {
    user_id: user.id,
    order_no: order.id,
    kind,
    status: order.status || 'pending',
    email: user.email || order.email || order.phone || null,
    buyer: order.buyer || null,
    payload: order
  };
}

async function upsertOrder(user, order) {
  const existing = await vectoree(`/api/database/records/${TABLE}`, {
    query: { order_no: `eq.${order.id}`, limit: '1' }
  });
  const rows = Array.isArray(existing.data) ? existing.data : [];
  const row = orderToRow(user, order);
  if (rows.length) {
    const patched = await vectoree(`/api/database/records/${TABLE}`, {
      method: 'PATCH',
      query: { order_no: `eq.${order.id}` },
      extraHeaders: { Prefer: 'return=representation' },
      body: {
        status: row.status,
        email: row.email,
        buyer: row.buyer,
        payload: row.payload
      }
    });
    return patched;
  }
  return vectoree(`/api/database/records/${TABLE}`, {
    method: 'POST',
    extraHeaders: { Prefer: 'return=representation' },
    body: [row]
  });
}

async function listOrders({ userId } = {}) {
  const query = { limit: '1000', order: 'created_at.desc' };
  if (userId) query.user_id = `eq.${userId}`;
  const result = await vectoree(`/api/database/records/${TABLE}`, { query });
  const rows = Array.isArray(result.data) ? result.data : [];
  return { ok: result.ok, status: result.status, orders: rows.map(rowToOrder), error: result.ok ? null : result.data };
}

const AUTH_PATHS = {
  register: '/api/auth/users',
  login: '/api/auth/sessions',
  'send-verification': '/api/auth/email/send-verification',
  verify: '/api/auth/email/verify'
};

async function handleApi(req, res, url) {
  if (req.method === 'OPTIONS') {
    send(res, 204, '', { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/app-auth') {
    const raw = await readBody(req);
    const body = raw ? JSON.parse(raw) : {};
    const { action, ...rest } = body;
    const pathname = AUTH_PATHS[action];
    if (!pathname) return send(res, 400, { message: 'invalid action' });
    const upstream = await vectoree(pathname, {
      method: 'POST',
      query: { client_type: 'server' },
      body: rest
    });
    return send(res, upstream.status, upstream.data || {});
  }

  if (req.method === 'GET' && url.pathname === '/api/app-session') {
    const auth = await requireAppUser(req);
    if (auth.error) return send(res, auth.error.status, auth.error.body);
    return send(res, 200, { user: auth.user });
  }

  if (req.method === 'GET' && url.pathname === '/api/park/orders') {
    const auth = await requireAppUser(req);
    if (auth.error) return send(res, auth.error.status, auth.error.body);
    const listed = await listOrders({ userId: auth.user.id });
    if (!listed.ok) return send(res, listed.status, listed.error);
    return send(res, 200, { orders: listed.orders });
  }

  if (req.method === 'POST' && url.pathname === '/api/park/orders') {
    const auth = await requireAppUser(req);
    if (auth.error) return send(res, auth.error.status, auth.error.body);
    const raw = await readBody(req);
    const order = raw ? JSON.parse(raw) : {};
    if (!order.id) return send(res, 400, { message: 'missing order id' });
    order.userId = auth.user.id;
    order.email = auth.user.email;
    order.phone = auth.user.email;
    const saved = await upsertOrder(auth.user, order);
    if (!saved.ok) return send(res, saved.status, saved.data || { message: '保存订单失败' });
    return send(res, 200, { order });
  }

  if (req.method === 'POST' && url.pathname === '/api/park/admin/orders') {
    const raw = await readBody(req);
    const order = raw ? JSON.parse(raw) : {};
    if (!order.id || !order.userId) return send(res, 400, { message: 'missing order id or user' });
    const saved = await upsertOrder({ id: order.userId, email: order.email || order.phone }, order);
    if (!saved.ok) return send(res, saved.status, saved.data || { message: '保存订单失败' });
    return send(res, 200, { order });
  }

  if (req.method === 'GET' && url.pathname === '/api/park/admin/orders') {
    const listed = await listOrders();
    if (!listed.ok) return send(res, listed.status, listed.error);
    return send(res, 200, { orders: listed.orders });
  }

  if (req.method === 'DELETE' && url.pathname === '/api/park/admin/orders') {
    const listed = await listOrders();
    if (!listed.ok) return send(res, listed.status, listed.error);
    for (const order of listed.orders) {
      await vectoree(`/api/database/records/${TABLE}`, {
        method: 'DELETE',
        query: { order_no: `eq.${order.id}` }
      });
    }
    return send(res, 200, { ok: true });
  }

  if (req.method === 'GET' && url.pathname === '/api/park/admin/users') {
    const users = await vectoree('/api/auth/users', { query: { limit: '100', offset: '0' } });
    const listed = await listOrders();
    const fromAuth = users.ok && Array.isArray(users.data?.data) ? users.data.data : [];
    const mapped = fromAuth.map((u) => ({
      id: u.id,
      phone: u.email,
      email: u.email,
      nickname: (u.profile && u.profile.name) || nicknameFromEmail(u.email),
      registeredAt: u.createdAt || u.created_at
    }));
    if (mapped.length === 0 && listed.ok) {
      const seen = new Map();
      for (const o of listed.orders) {
        const key = o.userId || o.email || o.phone;
        if (!key || seen.has(key)) continue;
        seen.set(key, {
          id: o.userId,
          phone: o.email || o.phone,
          email: o.email || o.phone,
          nickname: o.buyer || nicknameFromEmail(o.email || o.phone),
          registeredAt: o.createdAt
        });
      }
      return send(res, 200, { users: [...seen.values()] });
    }
    return send(res, 200, { users: mapped });
  }

  send(res, 404, { message: 'not found' });
}

function nicknameFromEmail(email) {
  if (!email) return '星际探索者';
  const local = String(email).split('@')[0];
  return local || '星际探索者';
}

function safeJoin(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0]);
  const rel = decoded === '/' ? '/index.html' : decoded;
  const abs = path.normalize(path.join(ROOT, rel));
  if (!abs.startsWith(ROOT)) return null;
  return abs;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://127.0.0.1:${PORT}`);
    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url);
      return;
    }
    let filePath = safeJoin(url.pathname);
    if (!filePath) return send(res, 403, { message: 'forbidden' });
    if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
      filePath = path.join(filePath, 'index.html');
    }
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      return send(res, 404, 'Not found', { 'Content-Type': 'text/plain; charset=utf-8' });
    }
    const ext = path.extname(filePath).toLowerCase();
    send(res, 200, fs.readFileSync(filePath), { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  } catch (err) {
    send(res, 500, { message: err.message || 'server error' });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`星屿乐园已启动：http://127.0.0.1:${PORT}`);
  console.log(`App  http://127.0.0.1:${PORT}/pages/app-v2.html`);
  console.log(`后台 http://127.0.0.1:${PORT}/pages/admin-v2.html`);
});
