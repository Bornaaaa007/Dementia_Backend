// Pure logic for the "away from the safe area" feature: no database, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  distanceMeters, classifyPing, decide, formatDistance,
  CONFIRM_PINGS, RETURN_PINGS, SAFE_WINDOW_MS, MAX_ACCURACY_M,
} from '../lib/geofence.js';
import { readPing, readLocationSettings, readSafeNote } from '../lib/locationInput.js';

const HOME = { lat: 23.8103, lng: 90.4125, radiusM: 150 }; // Dhaka
// move north by `m` metres (1 degree of latitude is about 111,195 m)
const north = (m) => ({ lat: HOME.lat + m / 111195, lng: HOME.lng });

test('distance: known points', () => {
  assert.equal(Math.round(distanceMeters(HOME, HOME)), 0);
  const d = distanceMeters(HOME, north(1000));
  assert.ok(Math.abs(d - 1000) < 5, `got ${d}`);
});

test('classify: inside, outside, and the uncertain band', () => {
  assert.equal(classifyPing(HOME, { ...north(40), accuracy: 10 }).where, 'inside');
  assert.equal(classifyPing(HOME, { ...north(400), accuracy: 15 }).where, 'outside');
  // 170 m away with a 40 m error circle: might still be inside the 150 m zone -> do not claim anything
  assert.equal(classifyPing(HOME, { ...north(170), accuracy: 40 }).where, 'unknown');
  // a very imprecise reading never counts, even if it is far away
  assert.equal(classifyPing(HOME, { ...north(2000), accuracy: MAX_ACCURACY_M + 1 }).where, 'unknown');
  // no accuracy given: treated as exact
  assert.equal(classifyPing(HOME, north(300)).where, 'outside');
});

test('decide: one stray outside reading does not raise an alert', () => {
  const first = decide({ where: 'outside', open: null });
  assert.equal(first.action, 'none');
  assert.equal(first.outsideStreak, 1);
  const second = decide({ where: 'outside', outsideStreak: first.outsideStreak, open: null });
  assert.equal(CONFIRM_PINGS, 2);
  assert.equal(second.action, 'open');
});

test('decide: an inside reading resets the outside streak', () => {
  const s = decide({ where: 'inside', outsideStreak: 1, open: null });
  assert.equal(s.outsideStreak, 0);
  assert.equal(decide({ where: 'outside', outsideStreak: s.outsideStreak, open: null }).action, 'none');
});

test('decide: unknown readings change nothing', () => {
  const s = decide({ where: 'unknown', outsideStreak: 1, insideStreak: 0, open: null });
  assert.deepEqual(s, { outsideStreak: 1, insideStreak: 0, action: 'none' });
});

test('decide: an already-open episode is not opened again', () => {
  const s = decide({ where: 'outside', outsideStreak: 5, open: { status: 'active' } });
  assert.equal(s.action, 'none');
});

test('decide: the episode ends only after consecutive inside readings', () => {
  const open = { status: 'active' };
  const one = decide({ where: 'inside', insideStreak: 0, open });
  assert.equal(one.action, 'none');
  assert.equal(RETURN_PINGS, 2);
  assert.equal(decide({ where: 'inside', insideStreak: one.insideStreak, open }).action, 'return');
  // bouncing on the border (inside, outside, inside) does not close it
  const out = decide({ where: 'outside', insideStreak: one.insideStreak, open });
  assert.equal(out.insideStreak, 0);
});

test('decide: after "safe with me" nothing re-alerts, until the safe window has passed', () => {
  const now = Date.now();
  const fresh = { status: 'safe', safeAt: new Date(now - 60 * 60000) };
  assert.equal(decide({ where: 'outside', outsideStreak: 9, open: fresh, now }).action, 'none');
  const expired = { status: 'safe', safeAt: new Date(now - SAFE_WINDOW_MS - 1000) };
  assert.equal(decide({ where: 'outside', outsideStreak: 9, open: expired, now }).action, 'reopen');
  // being back home still closes a "safe" episode quietly
  assert.equal(decide({ where: 'inside', insideStreak: 1, open: fresh, now }).action, 'return');
});

test('formatDistance', () => {
  assert.equal(formatDistance(234), '230 m');
  assert.equal(formatDistance(1480), '1.5 km');
  assert.equal(formatDistance(NaN), '');
});

test('readPing: validates coordinates and keeps optional fields', () => {
  assert.deepEqual(readPing({ lat: '23.8', lng: 90.4 }), { lat: 23.8, lng: 90.4 });
  assert.equal(readPing({ lat: 1, lng: 2, accuracy: 12 }).accuracy, 12);
  assert.ok(readPing({ lat: 1, lng: 2, at: '2026-11-27T10:00:00Z' }).at instanceof Date);
  assert.equal(readPing({ lat: 1, lng: 2, at: 'nonsense' }).at, undefined);
  assert.throws(() => readPing({ lat: 91, lng: 0 }), /not valid/);
  assert.throws(() => readPing({ lat: 'x', lng: 0 }), /not valid/);
  assert.throws(() => readPing({}), /not valid/);
});

test('readLocationSettings: tracking flag and safe area', () => {
  assert.deepEqual(readLocationSettings({}), {});
  assert.equal(readLocationSettings({ trackingEnabled: true }).trackingEnabled, true);
  assert.equal(readLocationSettings({ trackingEnabled: 'yes' }).trackingEnabled, false); // only a real true turns it on
  const z = readLocationSettings({ safeZone: { lat: 23.8, lng: 90.4, radiusM: 200, label: ' Home ' } }).safeZone;
  assert.deepEqual(z, { label: 'Home', lat: 23.8, lng: 90.4, radiusM: 200 });
  assert.equal(readLocationSettings({ safeZone: { lat: 23.8, lng: 90.4 } }).safeZone.radiusM, 150); // default
  assert.throws(() => readLocationSettings({ safeZone: { lat: 23.8, lng: 90.4, radiusM: 10 } }), /radius/);
  assert.throws(() => readLocationSettings({ safeZone: { lat: 23.8, lng: 90.4, radiusM: 99999 } }), /radius/);
  assert.throws(() => readLocationSettings({ safeZone: { lat: 'a', lng: 1 } }), /valid location/);
  assert.throws(() => readLocationSettings({ safeZone: { lat: 1, lng: 1, label: 'x'.repeat(41) } }), /40/);
});

test('readSafeNote', () => {
  assert.equal(readSafeNote({}), '');
  assert.equal(readSafeNote({ note: '  At the pharmacy  ' }), 'At the pharmacy');
  assert.throws(() => readSafeNote({ note: 'x'.repeat(201) }), /200/);
});
