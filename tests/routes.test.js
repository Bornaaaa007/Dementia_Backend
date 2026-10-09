// Wiring checks that never reach the database: guards, validation, device-token rejection.
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { toNodeHandler } from 'better-auth/node';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { createAuth } from '../lib/authConfig.js';
import { makeRequireAuth } from '../middleware/requireAuth.js';
import patientRoutes from '../routes/patients.js';
import settingsRoutes from '../routes/settings.js';
import deviceRoutes from '../routes/device.js';

const PORT = 5098;
process.env.BETTER_AUTH_SECRET = 'test-secret-test-secret-test-secret-123';
process.env.BETTER_AUTH_URL = `http://localhost:${PORT}`;
const base = `http://localhost:${PORT}`;
let server, cookie;

test.before(async () => {
  const auth = createAuth(memoryAdapter({ user: [], session: [], account: [], verification: [] }));
  const requireAuth = makeRequireAuth(auth);
  const app = express();
  app.all('/api/auth/*splat', toNodeHandler(auth));
  app.use(express.json({ limit: '3mb' }));
  app.use('/api/patients', requireAuth, patientRoutes);
  app.use('/api/settings', requireAuth, settingsRoutes);
  app.use('/api/patient-device', deviceRoutes);
  await new Promise((r) => { server = app.listen(PORT, r); });
  const res = await fetch(base + '/api/auth/sign-up/email', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base },
    body: JSON.stringify({ name: 'Fam', email: 'f@test.com', password: 'password123' }),
  });
  cookie = res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
});
test.after(() => server.close());

const call = (path, opts = {}) => fetch(base + path, {
  ...opts, headers: { 'Content-Type': 'application/json', ...(opts.cookie === false ? {} : { Cookie: cookie }), ...(opts.headers || {}) },
});

test('family routes reject anonymous users', async () => {
  for (const p of ['/api/patients', '/api/settings', '/api/patients/abc/dashboard']) {
    assert.equal((await call(p, { cookie: false })).status, 401, p);
  }
});

test('invalid patient id is rejected before any database call', async () => {
  assert.equal((await call('/api/patients/not-an-id/dashboard')).status, 400);
  assert.equal((await call('/api/patients/not-an-id', { method: 'PUT', body: '{}' })).status, 400);
});

test('creating a patient validates the name before touching the database', async () => {
  const res = await call('/api/patients', { method: 'POST', body: JSON.stringify({ name: '   ' }) });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /name is required/i);
  const bad = await call('/api/patients', { method: 'POST', body: JSON.stringify({ name: 'A', age: 400 }) });
  assert.equal(bad.status, 400);
  const photo = await call('/api/patients', { method: 'POST', body: JSON.stringify({ name: 'A', photoUrl: 'http://evil/x.png' }) });
  assert.equal(photo.status, 400);
});

test('join requires an invite code', async () => {
  assert.equal((await call('/api/patients/join', { method: 'POST', body: '{}' })).status, 400);
});

test('settings validate the stale threshold', async () => {
  // validation runs before the database write
  const res = await call('/api/settings', { method: 'PUT', body: JSON.stringify({ staleAfterHours: 9999 }) });
  assert.equal(res.status, 400);
});

test('patient device endpoints reject missing or wrong tokens', async () => {
  assert.equal((await call('/api/patient-device/me', { cookie: false })).status, 401);
  assert.equal((await call('/api/patient-device/pair', { method: 'POST', cookie: false, body: '{}' })).status, 400);
});
