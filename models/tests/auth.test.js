import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { toNodeHandler } from 'better-auth/node';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { createAuth } from '../lib/authConfig.js';
import { makeRequireAuth } from '../middleware/requireAuth.js';

process.env.BETTER_AUTH_SECRET = 'test-secret-test-secret-test-secret-123';
const PORT = 5099;
process.env.BETTER_AUTH_URL = `http://localhost:${PORT}`;

let server, base, token;
const cookies = {};

test.before(async () => {
  const auth = createAuth(memoryAdapter({ user: [], session: [], account: [], verification: [] }));
  const app = express();
  app.all('/api/auth/*splat', toNodeHandler(auth));
  app.use(express.json());
  app.get('/api/me', makeRequireAuth(auth), (req, res) => res.json({ user: req.user }));
  await new Promise((r) => { server = app.listen(PORT, r); });
  base = `http://localhost:${PORT}`;

  // capture the reset token the server prints
  const orig = console.log;
  console.log = (...a) => {
    const m = String(a[0]).match(/token:\s+(\S+)/);
    if (m) token = m[1];
    else orig(...a);
  };
});
test.after(() => server.close());

const post = (path, body, cookie) => fetch(base + path, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: base, ...(cookie ? { Cookie: cookie } : {}) },
  body: JSON.stringify(body),
});
const cookieOf = (res) => res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');

test('protected route rejects anonymous requests', async () => {
  const res = await fetch(base + '/api/me');
  assert.equal(res.status, 401);
  assert.equal((await res.json()).code, 'NO_SESSION');
});

test('sign up creates a session that unlocks protected routes', async () => {
  const res = await post('/api/auth/sign-up/email', { name: 'Ayesha', email: 'a@test.com', password: 'password123' });
  assert.equal(res.status, 200);
  cookies.signup = cookieOf(res);
  const me = await fetch(base + '/api/me', { headers: { Cookie: cookies.signup } });
  assert.equal(me.status, 200);
  assert.equal((await me.json()).user.email, 'a@test.com');
});

test('short passwords and duplicate emails are rejected', async () => {
  assert.notEqual((await post('/api/auth/sign-up/email', { name: 'B', email: 'b@test.com', password: 'short' })).status, 200);
  assert.notEqual((await post('/api/auth/sign-up/email', { name: 'A2', email: 'a@test.com', password: 'password123' })).status, 200);
});

test('wrong password is rejected, right password works', async () => {
  assert.equal((await post('/api/auth/sign-in/email', { email: 'a@test.com', password: 'wrongpass99' })).status, 401);
  assert.equal((await post('/api/auth/sign-in/email', { email: 'a@test.com', password: 'password123' })).status, 200);
});

test('sign out invalidates the session', async () => {
  const login = await post('/api/auth/sign-in/email', { email: 'a@test.com', password: 'password123' });
  const cookie = cookieOf(login);
  assert.equal((await fetch(base + '/api/me', { headers: { Cookie: cookie } })).status, 200);
  await post('/api/auth/sign-out', {}, cookie);
  assert.equal((await fetch(base + '/api/me', { headers: { Cookie: cookie } })).status, 401);
});

test('password reset: request token, reset, old password stops working', async () => {
  const req = await post('/api/auth/request-password-reset', { email: 'a@test.com' });
  assert.equal(req.status, 200);
  await new Promise((r) => setTimeout(r, 100));
  assert.ok(token, 'token should have been printed');
  assert.equal((await post('/api/auth/reset-password', { newPassword: 'newpassword456', token: 'bad-token' })).status >= 400, true);
  assert.equal((await post('/api/auth/reset-password', { newPassword: 'newpassword456', token })).status, 200);
  assert.equal((await post('/api/auth/sign-in/email', { email: 'a@test.com', password: 'password123' })).status, 401);
  assert.equal((await post('/api/auth/sign-in/email', { email: 'a@test.com', password: 'newpassword456' })).status, 200);
});

test('reset request for unknown email does not reveal that it is unknown', async () => {
  const res = await post('/api/auth/request-password-reset', { email: 'nobody@test.com' });
  assert.equal(res.status, 200);
});
