// Walks a fake patient out of the safe area and back, against in-memory stand-ins for the database models.
// Needs Node 22+ with module mocking:   node --test --experimental-test-module-mocks tests/wander.test.js
// (without that flag these tests are skipped, so plain `npm test` still passes)
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

const canMock = typeof mock.module === 'function';
const url = (p) => new URL(p, import.meta.url).href;

const db = { locations: [], events: [], alerts: [], activities: [] };
const pushes = [];
let seq = 0;
const matches = (doc, q) => Object.entries(q).every(([k, v]) => (v === null ? doc[k] == null : String(doc[k]) === String(v)));
const withSave = (doc, list) => Object.assign(doc, { async save() { return doc; } });

let processPing, endOpenEvents;
if (canMock) {
  const model = (def) => ({ defaultExport: def });
  mock.module(url('../models/PatientLocation.js'), model({
    async findOne(q) { return db.locations.find((d) => matches(d, q)) || null; },
    async updateOne(q, u) {
      let doc = db.locations.find((d) => matches(d, q));
      if (!doc) { doc = { ...u.$setOnInsert }; db.locations.push(doc); }
      Object.assign(doc, u.$set);
      return { ok: 1 };
    },
    async deleteOne() {},
  }));
  mock.module(url('../models/WanderEvent.js'), model({
    async findOne(q) { return db.events.find((d) => matches(d, q)) || null; },
    async find(q) { return db.events.filter((d) => matches(d, q)); },
    async create(doc) {
      if (db.events.some((e) => e.open && String(e.patient) === String(doc.patient))) throw Object.assign(new Error('dup'), { code: 11000 });
      const e = withSave({ _id: `ev${++seq}`, open: true, ...doc }, db.events);
      db.events.push(e);
      return e;
    },
    async updateOne(q, u) {
      const e = db.events.find((d) => matches(d, q));
      Object.assign(e, u.$set);
      if (u.$max) for (const [k, v] of Object.entries(u.$max)) e[k] = Math.max(e[k] || 0, v);
    },
  }));
  mock.module(url('../models/Alert.js'), model({
    async create(doc) { const a = { _id: `al${++seq}`, resolvedAt: null, ...doc }; db.alerts.push(a); return a; },
    async updateOne(q, u) { const a = db.alerts.find((d) => matches(d, q)); if (a) Object.assign(a, u); },
  }));
  mock.module(url('../models/Activity.js'), model({ async create(doc) { db.activities.push(doc); } }));
  mock.module(url('../lib/push.js'), { namedExports: { async notifyFamily(patient, msg, opts) { pushes.push({ msg, opts }); } } });
  ({ processPing, endOpenEvents } = await import('../lib/wander.js'));
}

const HOME = { label: 'Home', lat: 23.8103, lng: 90.4125, radiusM: 150 };
const north = (m) => ({ lat: HOME.lat + m / 111195, lng: HOME.lng, accuracy: 10 });
const patient = { _id: 'p1', name: 'Grandma', createdBy: 'u1', members: ['u2'] };
const settings = { trackingEnabled: true, safeZone: HOME };
const T0 = new Date('2026-11-27T10:00:00Z').getTime();
const at = (min) => new Date(T0 + min * 60000);
const ping = (m, min, s = settings) => processPing(patient, north(m), s, at(min));
const openEvent = () => db.events.find((e) => e.open);
const reset = () => { db.locations.length = db.events.length = db.alerts.length = db.activities.length = 0; pushes.length = 0; };

test('a full walk-away: alert once, "safe with me" silences it, still-away re-alerts, coming home closes it', { skip: !canMock }, async () => {
  reset();

  await ping(30, 0); await ping(40, 1);
  assert.equal(db.events.length, 0, 'at home: nothing happens');
  assert.equal(db.locations.length, 1);

  await ping(400, 2);
  assert.equal(db.events.length, 0, 'one outside reading is not enough');
  await ping(420, 3);
  assert.equal(db.events.length, 1, 'second outside reading opens the episode');
  assert.equal(db.alerts.length, 1);
  assert.equal(db.alerts[0].type, 'away_from_zone');
  assert.equal(db.alerts[0].severity, 'critical');
  assert.equal(db.alerts[0].ref, `wander:${openEvent()._id}`);
  assert.equal(pushes.length, 1);
  assert.equal(pushes[0].opts.preference, 'notifyLocationAlerts');
  assert.match(pushes[0].msg.title, /Grandma is away from Home/);

  await ping(500, 4); await ping(650, 5);
  assert.equal(db.alerts.length, 1, 'no second alert while still away');
  assert.equal(pushes.length, 1);
  assert.ok(openEvent().maxDistanceM >= 640, 'furthest distance is tracked');

  // a caregiver taps "I'm with them" (what POST /events/:eid/safe does)
  const ev = openEvent();
  Object.assign(ev, { status: 'safe', safeBy: 'u2', safeByName: 'Rahim', safeAt: at(6) });
  db.alerts[0].resolvedAt = at(6);

  await ping(700, 60);
  await ping(720, 120);
  assert.equal(db.alerts.length, 1, 'no new alert during the safe window');
  assert.equal(pushes.length, 1);

  await ping(800, 6 + 4 * 60 + 1); // 4 hours later and still away
  assert.equal(db.alerts.length, 2, 'safe window over: the family is alerted again');
  assert.equal(openEvent().status, 'active');
  assert.match(db.alerts[1].message, /Rahim/);
  assert.equal(pushes.length, 2);

  await ping(20, 300);
  assert.ok(openEvent(), 'one inside reading is not enough to close it');
  await ping(15, 301);
  assert.equal(openEvent(), undefined, 'two inside readings close the episode');
  assert.equal(db.events[0].status, 'returned');
  assert.ok(db.alerts.every((a) => a.resolvedAt), 'all alerts are cleared automatically');
  assert.equal(pushes.length, 3, 'family is told they are back (they had not been confirmed)');
  assert.match(pushes[2].msg.title, /back at Home/);
});

test('coming home after "safe with me" is quiet', { skip: !canMock }, async () => {
  reset();
  await ping(400, 0); await ping(410, 1);
  Object.assign(openEvent(), { status: 'safe', safeBy: 'u2', safeByName: 'Rahim', safeAt: at(2) });
  const before = pushes.length;
  await ping(10, 30); await ping(10, 31);
  assert.equal(openEvent(), undefined);
  assert.equal(pushes.length, before, 'no "back home" push when a caregiver was already with them');
});

test('bad GPS: a poor-accuracy jump far away never alerts', { skip: !canMock }, async () => {
  reset();
  for (let i = 0; i < 4; i++) await processPing(patient, { ...north(3000), accuracy: 400 }, settings, at(i));
  assert.equal(db.events.length, 0);
  assert.equal(db.locations[0].outsideStreak, 0);
});

test('readings that arrive out of order are ignored', { skip: !canMock }, async () => {
  reset();
  await ping(30, 10);
  const res = await ping(900, 5); // older than the stored one
  assert.equal(res.skipped, true);
  assert.equal(db.locations[0].recordedAt.getTime(), at(10).getTime());
});

test('no safe area set: position is stored, nothing is alerted', { skip: !canMock }, async () => {
  reset();
  const noZone = { trackingEnabled: true, safeZone: { label: 'Home', radiusM: 150 } };
  await ping(5000, 0, noZone); await ping(5000, 1, noZone); await ping(5000, 2, noZone);
  assert.equal(db.events.length, 0);
  assert.equal(db.locations.length, 1);
});

test('switching tracking off closes the open episode and clears its alert', { skip: !canMock }, async () => {
  reset();
  await ping(400, 0); await ping(410, 1);
  assert.equal(await endOpenEvents('p1', at(2)), 1);
  assert.equal(db.events[0].status, 'ended');
  assert.ok(db.alerts[0].resolvedAt);
});
