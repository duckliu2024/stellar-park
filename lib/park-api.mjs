/**
 * 星屿乐园 BFF。浏览器只访问 /api，Vectoree 密钥留在服务端。
 */
import fs from 'node:fs';
import path from 'node:path';

const VECTOREE_API = (process.env.VECTOREE_API_URL || 'https://vectoree.ai').replace(/\/$/, '');
const TABLE = 'park_orders';

const BARE_EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;
const NAMED_EMAIL = /^[^<>\r\n"]+ <[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+>$/;

export function loadApiKey(rootDir) {
  if (process.env.VECTOREE_API_KEY) return process.env.VECTOREE_API_KEY;
  if (rootDir) {
    try {
      const cfg = JSON.parse(fs.readFileSync(path.join(rootDir, '.vectoree', 'config.json'), 'utf8'));
      if (cfg.apiKey) return cfg.apiKey;
    } catch { /* optional local config */ }
  }
  throw new Error('missing VECTOREE_API_KEY');
}

export function isValidMailbox(value) {
  if (typeof value !== 'string') return false;
  const text = value.trim();
  return BARE_EMAIL.test(text) || NAMED_EMAIL.test(text);
}

/** 收件人地址本身无效时才怪邮箱；reply_to 之类的发信配置错误不要归咎用户。 */
export function recipientAddressRejected(message) {
  const text = String(message || '');
  if (/reply_to|reply-to|replyTo/i.test(text)) return false;
  return /invalid `to`|testing email address|example\.com|invalid email address|邮箱格式|address is invalid/i.test(text);
}

export function explainAuthFailure(data) {
  if (!data) return '';
  const code = data.error || '';
  const message = String(data.message || '');
  if (code === 'EMAIL_SMTP_SEND_FAILED' || /reply_to|reply-to/i.test(message)) {
    if (recipientAddressRejected(message)) {
      return '验证码邮件没发出去。请换一个真实邮箱，example.com 这类地址收不到。';
    }
    return '验证码暂时发不出去，请稍后再试。';
  }
  return '';
}

function adminAllowlist() {
  return String(process.env.ADMIN_EMAILS || '')
    .split(/[,;\s]+/)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

export function userIsAdmin(user) {
  if (!user) return false;
  const email = String(user.email || '').trim().toLowerCase();
  if (email && adminAllowlist().includes(email)) return true;
  const profile = user.profile && typeof user.profile === 'object' ? user.profile : {};
  const role = String(profile.role || profile.adminRole || user.role || '').toLowerCase();
  if (role === 'admin') return true;
  if (profile.admin === true || user.admin === true) return true;
  return false;
}

function sanitizeAuthBody(action, rest) {
  const body = { ...(rest || {}) };
  for (const key of ['reply_to', 'replyTo', 'from', 'sender', 'senderEmail', 'senderName']) {
    if (key in body && !isValidMailbox(body[key]) && key !== 'senderName') delete body[key];
  }
  if (body.senderName != null && typeof body.senderName !== 'string') delete body.senderName;
  const configured = process.env.AUTH_EMAIL_REPLY_TO;
  if ((action === 'send-verification' || action === 'register' || action === 'login') && isValidMailbox(configured)) {
    body.replyTo = configured.trim();
  }
  return body;
}

function send(res, status, body, headers = {}) {
  const payload = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': headers['Content-Type'] || 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
    ...headers
  });
  res.end(payload);
}

function readBody(req) {
  if (req.body != null && req.body !== '') {
    return Promise.resolve(typeof req.body === 'string' ? req.body : JSON.stringify(req.body));
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 2_000_000) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function vectoree(pathname, { method = 'GET', body, token, query, extraHeaders, rootDir } = {}) {
  const url = new URL(VECTOREE_API + pathname);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value != null && value !== '') url.searchParams.set(key, String(value));
    }
  }
  const headers = {
    Authorization: 'Bearer ' + (token || loadApiKey(rootDir)),
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

async function requireAppUser(req, rootDir) {
  const header = req.headers.authorization || req.headers.Authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return { error: { status: 401, body: { message: '请先登录' } } };
  const session = await vectoree('/api/auth/sessions/current', { token, rootDir });
  if (!session.ok || !session.data?.user?.id) {
    return { error: { status: 401, body: session.data || { message: '登录已过期' } } };
  }
  return { user: session.data.user, token };
}

async function requireAdmin(req, rootDir) {
  const auth = await requireAppUser(req, rootDir);
  if (auth.error) return auth;
  if (!userIsAdmin(auth.user)) {
    const configured = adminAllowlist().length > 0;
    return {
      error: {
        status: 403,
        body: {
          message: configured ? '没有后台权限' : '后台尚未配置管理员邮箱'
        }
      }
    };
  }
  return auth;
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

async function upsertOrder(user, order, rootDir) {
  const existing = await vectoree(`/api/database/records/${TABLE}`, {
    rootDir,
    query: { order_no: `eq.${order.id}`, limit: '1' }
  });
  const rows = Array.isArray(existing.data) ? existing.data : [];
  const row = orderToRow(user, order);
  if (rows.length) {
    return vectoree(`/api/database/records/${TABLE}`, {
      method: 'PATCH',
      rootDir,
      query: { order_no: `eq.${order.id}` },
      extraHeaders: { Prefer: 'return=representation' },
      body: {
        status: row.status,
        email: row.email,
        buyer: row.buyer,
        payload: row.payload
      }
    });
  }
  return vectoree(`/api/database/records/${TABLE}`, {
    method: 'POST',
    rootDir,
    extraHeaders: { Prefer: 'return=representation' },
    body: [row]
  });
}

async function listOrders({ userId, rootDir } = {}) {
  const query = { limit: '1000', order: 'created_at.desc' };
  if (userId) query.user_id = `eq.${userId}`;
  const result = await vectoree(`/api/database/records/${TABLE}`, { query, rootDir });
  const rows = Array.isArray(result.data) ? result.data : [];
  return { ok: result.ok, status: result.status, orders: rows.map(rowToOrder), error: result.ok ? null : result.data };
}

const AUTH_PATHS = {
  register: '/api/auth/users',
  login: '/api/auth/sessions',
  'send-verification': '/api/auth/email/send-verification',
  verify: '/api/auth/email/verify'
};

function nicknameFromEmail(email) {
  if (!email) return '星际探索者';
  const local = String(email).split('@')[0];
  return local || '星际探索者';
}

function withUserMessage(data) {
  const friendly = explainAuthFailure(data);
  if (!friendly || !data || typeof data !== 'object') return data;
  return { ...data, userMessage: friendly };
}

export async function handleApi(req, res, url, rootDir) {
  if (req.method === 'OPTIONS') {
    send(res, 204, '', {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS'
    });
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
      rootDir,
      query: { client_type: 'server' },
      body: sanitizeAuthBody(action, rest)
    });
    return send(res, upstream.status, withUserMessage(upstream.data || {}));
  }

  if (req.method === 'GET' && url.pathname === '/api/app-session') {
    const auth = await requireAppUser(req, rootDir);
    if (auth.error) return send(res, auth.error.status, auth.error.body);
    return send(res, 200, { user: auth.user });
  }

  if (req.method === 'GET' && url.pathname === '/api/park/admin/session') {
    const auth = await requireAdmin(req, rootDir);
    if (auth.error) return send(res, auth.error.status, auth.error.body);
    return send(res, 200, {
      ok: true,
      email: auth.user.email,
      name: (auth.user.profile && auth.user.profile.name) || nicknameFromEmail(auth.user.email)
    });
  }

  if (req.method === 'GET' && url.pathname === '/api/park/orders') {
    const auth = await requireAppUser(req, rootDir);
    if (auth.error) return send(res, auth.error.status, auth.error.body);
    const listed = await listOrders({ userId: auth.user.id, rootDir });
    if (!listed.ok) return send(res, listed.status, listed.error);
    return send(res, 200, { orders: listed.orders });
  }

  if (req.method === 'POST' && url.pathname === '/api/park/orders') {
    const auth = await requireAppUser(req, rootDir);
    if (auth.error) return send(res, auth.error.status, auth.error.body);
    const raw = await readBody(req);
    const order = raw ? JSON.parse(raw) : {};
    if (!order.id) return send(res, 400, { message: 'missing order id' });
    order.userId = auth.user.id;
    order.email = auth.user.email;
    order.phone = auth.user.email;
    const saved = await upsertOrder(auth.user, order, rootDir);
    if (!saved.ok) return send(res, saved.status, saved.data || { message: '保存订单失败' });
    return send(res, 200, { order });
  }

  if (url.pathname.startsWith('/api/park/admin/')) {
    const auth = await requireAdmin(req, rootDir);
    if (auth.error) return send(res, auth.error.status, auth.error.body);

    if (req.method === 'POST' && url.pathname === '/api/park/admin/orders') {
      const raw = await readBody(req);
      const order = raw ? JSON.parse(raw) : {};
      if (!order.id || !order.userId) return send(res, 400, { message: 'missing order id or user' });
      const saved = await upsertOrder({ id: order.userId, email: order.email || order.phone }, order, rootDir);
      if (!saved.ok) return send(res, saved.status, saved.data || { message: '保存订单失败' });
      return send(res, 200, { order });
    }

    if (req.method === 'GET' && url.pathname === '/api/park/admin/orders') {
      const listed = await listOrders({ rootDir });
      if (!listed.ok) return send(res, listed.status, listed.error);
      return send(res, 200, { orders: listed.orders });
    }

    if (req.method === 'DELETE' && url.pathname === '/api/park/admin/orders') {
      const listed = await listOrders({ rootDir });
      if (!listed.ok) return send(res, listed.status, listed.error);
      for (const order of listed.orders) {
        await vectoree(`/api/database/records/${TABLE}`, {
          method: 'DELETE',
          rootDir,
          query: { order_no: `eq.${order.id}` }
        });
      }
      return send(res, 200, { ok: true });
    }

    if (req.method === 'GET' && url.pathname === '/api/park/admin/users') {
      const users = await vectoree('/api/auth/users', { query: { limit: '100', offset: '0' }, rootDir });
      const listed = await listOrders({ rootDir });
      const fromAuth = users.ok && Array.isArray(users.data?.data) ? users.data.data : [];
      const mapped = fromAuth.map((user) => ({
        id: user.id,
        phone: user.email,
        email: user.email,
        nickname: (user.profile && user.profile.name) || nicknameFromEmail(user.email),
        registeredAt: user.createdAt || user.created_at
      }));
      if (mapped.length === 0 && listed.ok) {
        const seen = new Map();
        for (const order of listed.orders) {
          const key = order.userId || order.email || order.phone;
          if (!key || seen.has(key)) continue;
          seen.set(key, {
            id: order.userId,
            phone: order.email || order.phone,
            email: order.email || order.phone,
            nickname: order.buyer || nicknameFromEmail(order.email || order.phone),
            registeredAt: order.createdAt
          });
        }
        return send(res, 200, { users: [...seen.values()] });
      }
      return send(res, 200, { users: mapped });
    }
  }

  send(res, 404, { message: 'not found' });
}
