import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDashboard } from '../lib/dashboard.js';
import { buildDemoData } from '../lib/demoData.js';

const NOW = new Date('2026-10-07T12:00:00Z'); // fixed time so results are repeatable
let n = 0;
const withIds = (docs) => docs.map((d) => ({ ...d, _id: `id${++n}` }));
const dash = (scenario, settings = {}) => {
  const d = buildDemoData({ scenario, now: NOW, tzOffsetMinutes: 0, userId: 'u1' });
  return buildDashboard({
    patient: { name: 'Grandma' }, activities: withIds(d.activities), reminders: withIds(d.reminders),
    alerts: withIds(d.alerts), settings, now: NOW, tzOffsetMinutes: 0,
  });
};

test('empty: no data state', () => {
  const r = dash('empty');
  assert.equal(r.dataState, 'empty');
  assert.equal(r.overview.status, 'empty');
  assert.equal(r.adherence.percent, null);
  assert.equal(r.mood.latest, null);
  assert.equal(r.alerts.unresolved.length, 0);
});

test('normal: fresh data with unresolved alerts', () => {
  const r = dash('normal');
  assert.equal(r.dataState, 'ok');
  assert.equal(r.alerts.unresolved.length, 2);          // resolved SOS is excluded
  assert.equal(r.overview.status, 'attention');
  assert.ok(r.adherence.percent > 60 && r.adherence.percent <= 100);
  assert.equal(r.mood.days.length, 7);
  assert.equal(r.mood.latest.value, 4);
  assert.ok(r.recentActivity.length === 10);
  assert.ok(r.reminders.today.length >= 3);
  // newest first
  assert.ok(new Date(r.recentActivity[0].at) >= new Date(r.recentActivity[1].at));
  // warning sorted before info
  assert.equal(r.alerts.unresolved[0].severity, 'warning');
});

test('stale: old patient activity is flagged', () => {
  const r = dash('stale');
  assert.equal(r.dataState, 'stale');
  assert.ok(r.lastPatientActivityAt < new Date(NOW - 48 * 3600000));
  assert.ok(r.alerts.unresolved.some((a) => a.type === 'inactivity'));
});

test('stale threshold from caregiver settings is respected', () => {
  const lenient = dash('stale', { staleAfterHours: 96 });
  assert.equal(lenient.dataState, 'ok');
});

test('critical alert sets critical status', () => {
  const d = buildDemoData({ scenario: 'normal', now: NOW, userId: 'u1' });
  d.alerts.push({ type: 'sos', severity: 'critical', message: 'SOS', raisedAt: NOW, demo: true });
  const r = buildDashboard({
    patient: { name: 'G' }, activities: withIds(d.activities), reminders: withIds(d.reminders), alerts: withIds(d.alerts), now: NOW,
  });
  assert.equal(r.overview.status, 'critical');
  assert.equal(r.alerts.unresolved[0].severity, 'critical');
});

test('only caregiver notes (no patient signal) counts as stale, not empty', () => {
  const r = buildDashboard({
    patient: { name: 'G' }, now: NOW,
    activities: [{ _id: 'a', type: 'note', message: 'hi', at: NOW, source: 'caregiver' }],
  });
  assert.equal(r.dataState, 'stale');
});

test('timezone: today list follows the caller\'s local day', () => {
  // 23:30 UTC on Oct 7 is already Oct 8 in Dhaka (UTC+6 -> offset -360)
  const late = new Date('2026-10-07T23:30:00Z');
  const d = buildDemoData({ scenario: 'normal', now: late, tzOffsetMinutes: -360, userId: 'u1' });
  const r = buildDashboard({
    patient: { name: 'G' }, activities: withIds(d.activities), reminders: withIds(d.reminders), alerts: withIds(d.alerts),
    now: late, tzOffsetMinutes: -360,
  });
  assert.ok(r.reminders.today.length >= 3);
  assert.ok(r.mood.days.at(-1).date === '2026-10-08');
});
