import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { APP_AUTH_ACTIONS, explainAuthFailure, handleApi, isValidMailbox, recipientAddressRejected, userIsAdmin } from '../lib/park-api.mjs';

test('mailbox shape', () => {
  assert.equal(isValidMailbox('guest@park.test'), true);
  assert.equal(isValidMailbox('星屿乐园 <noreply@stellar-park.vercel.app>'), true);
  assert.equal(isValidMailbox('no-reply@your-domain'), false);
  assert.equal(isValidMailbox(''), false);
  assert.equal(isValidMailbox('星屿乐园'), false);
});

test('reply_to failures are not blamed on the visitor address', () => {
  const data = {
    error: 'EMAIL_SMTP_SEND_FAILED',
    message: 'Failed to send email: Invalid `reply_to` field. The email address needs to follow the `email@example.com` or `Name <email@example.com>` format.'
  };
  assert.equal(recipientAddressRejected(data.message), false);
  assert.equal(explainAuthFailure(data), '暂时无法完成注册或登录，请稍后再试。');
});

test('email verification is not offered as a login step', () => {
  assert.equal(explainAuthFailure({ error: 'AUTH_NEED_VERIFICATION', message: 'Email verification required' }), '账号暂时无法登录，请稍后再试。');
  assert.equal(explainAuthFailure({ message: 'Too many new accounts from this network. Please try again later.' }), '操作太频繁，请稍后再试。');
  assert.equal(APP_AUTH_ACTIONS.register, '/api/auth/users');
  assert.equal(APP_AUTH_ACTIONS.login, '/api/auth/sessions');
  assert.equal(APP_AUTH_ACTIONS['send-verification'], undefined);
  assert.equal(APP_AUTH_ACTIONS.verify, undefined);
});

test('verification actions are rejected before any upstream call', async () => {
  for (const action of ['send-verification', 'verify']) {
    const res = { status: 0, body: '', writeHead(status) { this.status = status; }, end(body) { this.body = body; } };
    await handleApi(
      { method: 'POST', headers: {}, body: JSON.stringify({ action, email: 'guest@park.test', otp: '12345678' }) },
      res,
      new URL('http://127.0.0.1/api/app-auth')
    );
    assert.equal(res.status, 400);
    assert.match(String(res.body), /invalid action/);
  }
});

test('example.com recipient failures still mention the address', () => {
  const data = {
    error: 'EMAIL_SMTP_SEND_FAILED',
    message: 'Failed to send email: Invalid `to` field. Please use our testing email address instead of domains like `example.com`.'
  };
  assert.equal(recipientAddressRejected(data.message), true);
  assert.match(explainAuthFailure(data), /真实邮箱/);
});

function mockResponse(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

async function callApi(method, pathname, body) {
  const res = {
    status: 0,
    body: '',
    writeHead(status) { this.status = status; },
    end(payload) { this.body = payload; }
  };
  await handleApi(
    { method, headers: {}, body },
    res,
    new URL('http://127.0.0.1' + pathname)
  );
  return res;
}

test('admin page shows the dashboard without a login wall', () => {
  const html = fs.readFileSync(new URL('../pages/admin-v2.html', import.meta.url), 'utf8');
  assert.match(html, /id="admin-gate"[^>]*style="display:\s*none/);
  assert.match(html, /id="admin-shell" class="min-h-screen/);
  assert.doesNotMatch(html, /id="admin-shell" class="hidden/);
  assert.match(html, /adminReady = true;\s*bootAdminCloud\(\);/);
});

test('admin APIs succeed without a bearer token while customer orders stay closed', async () => {
  const previousKey = process.env.VECTOREE_API_KEY;
  process.env.VECTOREE_API_KEY = 'test-key-not-a-secret';
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const href = String(url);
    const method = (init && init.method) || 'GET';
    calls.push({ href, method, authorization: init && init.headers && init.headers.Authorization });
    if (href.includes('/api/auth/sessions/current')) {
      return mockResponse(401, { message: '未登录' });
    }
    if (method === 'GET' && href.includes('/api/database/records/park_orders')) {
      if (href.includes('order_no=eq.SP-2')) return mockResponse(200, []);
      return mockResponse(200, [{
        order_no: 'SP-1',
        user_id: 'user-1',
        email: 'guest@park.test',
        buyer: '游客',
        status: 'paid',
        kind: 'ticket',
        payload: { id: 'SP-1', status: 'paid', buyer: '游客', ticketName: '日间票' }
      }]);
    }
    if (method === 'POST' && href.includes('/api/database/records/park_orders')) {
      return mockResponse(201, [{ ok: true }]);
    }
    if (method === 'PATCH' && href.includes('/api/database/records/park_orders')) {
      return mockResponse(200, [{ ok: true }]);
    }
    if (method === 'DELETE' && href.includes('/api/database/records/park_orders')) {
      return mockResponse(200, []);
    }
    if (href.includes('/api/auth/users')) return mockResponse(200, { data: [] });
    return mockResponse(500, { message: 'unexpected' });
  };
  try {
    const session = await callApi('GET', '/api/park/admin/session');
    assert.equal(session.status, 200);
    assert.equal(JSON.parse(session.body).ok, true);
    assert.doesNotMatch(session.body, /没有后台权限/);

    const orders = await callApi('GET', '/api/park/admin/orders');
    assert.equal(orders.status, 200);
    assert.equal(JSON.parse(orders.body).orders[0].id, 'SP-1');

    const users = await callApi('GET', '/api/park/admin/users');
    assert.equal(users.status, 200);
    assert.ok(Array.isArray(JSON.parse(users.body).users));
    assert.equal(JSON.parse(users.body).users[0].email, 'guest@park.test');

    const saved = await callApi('POST', '/api/park/admin/orders', JSON.stringify({
      id: 'SP-2',
      userId: 'user-1',
      email: 'guest@park.test',
      status: 'refunded',
      buyer: '游客'
    }));
    assert.equal(saved.status, 200);

    const cleared = await callApi('DELETE', '/api/park/admin/orders');
    assert.equal(cleared.status, 200);

    const mine = await callApi('GET', '/api/park/orders');
    assert.equal(mine.status, 401);
    assert.match(mine.body, /请先登录/);

    const create = await callApi('POST', '/api/park/orders', JSON.stringify({ id: 'SP-3' }));
    assert.equal(create.status, 401);

    const appSession = await callApi('GET', '/api/app-session');
    assert.equal(appSession.status, 401);

    assert.equal(calls.some((hit) => hit.href.includes('/api/auth/sessions/current')), false);
    for (const hit of calls) {
      assert.equal(hit.authorization, 'Bearer test-key-not-a-secret');
    }
  } finally {
    globalThis.fetch = originalFetch;
    if (previousKey == null) delete process.env.VECTOREE_API_KEY;
    else process.env.VECTOREE_API_KEY = previousKey;
  }
});

test('admin allowlist is fail-closed unless the email is listed', () => {
  const previous = process.env.ADMIN_EMAILS;
  process.env.ADMIN_EMAILS = 'owner@park.test';
  try {
    assert.equal(userIsAdmin({ email: 'owner@park.test' }), true);
    assert.equal(userIsAdmin({ email: 'guest@park.test' }), false);
    assert.equal(userIsAdmin({ email: 'guest@park.test', profile: { role: 'admin' } }), true);
    assert.equal(userIsAdmin(null), false);
  } finally {
    if (previous == null) delete process.env.ADMIN_EMAILS;
    else process.env.ADMIN_EMAILS = previous;
  }
});
