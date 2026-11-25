import test from 'node:test';
import assert from 'node:assert/strict';
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
