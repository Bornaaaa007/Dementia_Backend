import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRoute, fetchWalkingRoute } from '../lib/routing.js';

const step = (type, modifier, lng, lat, distance, extra = {}) => ({ maneuver: { type, modifier, location: [lng, lat], ...extra }, distance, name: '' });

const sample = {
  routes: [{
    distance: 520, duration: 400,
    geometry: { coordinates: [[90.40, 23.80], [90.401, 23.80], [90.401, 23.801], [90.402, 23.801]] },
    legs: [{ steps: [
      step('depart', undefined, 90.40, 23.80, 100),
      step('new name', 'straight', 90.4005, 23.80, 40),     // nothing to say: merged
      step('turn', 'left', 90.401, 23.80, 200),
      step('turn', 'right', 90.401, 23.801, 180),
      step('arrive', undefined, 90.402, 23.801, 0),
    ] }],
  }],
};

test('parseRoute keeps only what a walker needs and merges "straight" steps', () => {
  const r = parseRoute(sample);
  assert.deepEqual(r.steps.map((s) => `${s.type}:${s.turn}`), ['depart:straight', 'turn:left', 'turn:right', 'arrive:straight']);
  assert.equal(r.steps[0].distanceM, 140, 'the merged straight step lengthens the first walk');
  assert.equal(r.distanceM, 520);
  assert.deepEqual(r.path[0], [23.8, 90.4]);
});

test('parseRoute handles roundabouts and fails clearly when there is no route', () => {
  const r = parseRoute({ routes: [{ distance: 10, duration: 5, legs: [{ steps: [
    step('depart', undefined, 1, 1, 5), step('roundabout', 'right', 1.001, 1, 5, { exit: 2 }), step('arrive', undefined, 1.002, 1, 0),
  ] }] }] });
  assert.equal(r.steps[1].turn, 'roundabout');
  assert.equal(r.steps[1].exit, 2);
  assert.throws(() => parseRoute({ routes: [] }), /No walking route/);
  assert.throws(() => parseRoute({}), /No walking route/);
});

test('fetchWalkingRoute: builds the URL (lng,lat order) and reports service errors', async () => {
  let seen;
  const ok = async (url) => { seen = url; return { ok: true, json: async () => sample }; };
  await fetchWalkingRoute({ lat: 23.8, lng: 90.4 }, { lat: 23.81, lng: 90.41 }, { fetchImpl: ok });
  assert.match(seen, /90\.4,23\.8;90\.41,23\.81\?steps=true/);
  await assert.rejects(fetchWalkingRoute({ lat: 1, lng: 1 }, { lat: 2, lng: 2 }, { fetchImpl: async () => ({ ok: false, status: 503 }) }), /not available/);
});
