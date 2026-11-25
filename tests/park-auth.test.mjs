import test from 'node:test';
import assert from 'node:assert/strict';
import { explainAuthFailure, isValidMailbox, recipientAddressRejected, userIsAdmin } from '../lib/park-api.mjs';

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
  assert.equal(explainAuthFailure(data), '验证码暂时发不出去，请稍后再试。');
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
