import Activity from '../models/Activity.js';
import Alert from '../models/Alert.js';
import PatientLocation from '../models/PatientLocation.js';
import WanderEvent from '../models/WanderEvent.js';
import { classifyPing, decide, formatDistance } from './geofence.js';
import { notifyFamily } from './push.js';

const PREF = 'notifyLocationAlerts';

// Handles one location report from the patient's device: stores the latest position,
// and opens / re-opens / closes an "away from the safe area" episode when needed.
export async function processPing(patient, ping, settings, now = new Date()) {
  const pid = patient._id;
  const zone = settings.safeZone?.lat != null && settings.safeZone?.lng != null ? settings.safeZone : null;
  const recordedAt = ping.at && ping.at.getTime() < now.getTime() ? ping.at : now;

  const prev = await PatientLocation.findOne({ patient: pid });
  if (prev?.recordedAt && recordedAt.getTime() <= prev.recordedAt.getTime()) return { skipped: true }; // arrived out of order

  const point = { lat: ping.lat, lng: ping.lng, accuracy: ping.accuracy };
  const save = (extra = {}) =>
    PatientLocation.updateOne({ patient: pid }, { $set: { ...point, recordedAt, ...extra }, $setOnInsert: { patient: pid } }, { upsert: true })
      .catch((e) => { if (e.code !== 11000) throw e; }); // two first reports at once: the other one already created it

  if (!zone) { await save(); return { zone: false }; } // location can be viewed, but there is nothing to alert about yet

  const open = await WanderEvent.findOne({ patient: pid, open: true });
  const { distanceM, where } = classifyPing(zone, ping);
  const next = decide({
    where, outsideStreak: prev?.outsideStreak ?? 0, insideStreak: prev?.insideStreak ?? 0,
    open, now: now.getTime(),
  });
  await save({ outsideStreak: next.outsideStreak, insideStreak: next.insideStreak });

  const label = zone.label || 'Home';
  const name = patient.name;

  if (next.action === 'open') {
    let event;
    try {
      event = await WanderEvent.create({
        patient: pid, status: 'active', open: true, zoneLabel: label, startedAt: now,
        startLocation: point, lastLocation: point, lastSeenAt: now, maxDistanceM: distanceM,
      });
    } catch (e) {
      if (e.code === 11000) return { action: 'none' }; // another report opened it a moment ago
      throw e;
    }
    const alert = await Alert.create({
      patient: pid, type: 'away_from_zone', severity: 'critical', ref: `wander:${event._id}`,
      message: `${name} has left ${label} and is about ${formatDistance(distanceM)} away`,
    });
    event.alertId = alert._id;
    await event.save();
    await Activity.create({ patient: pid, type: 'wander', message: `Left ${label}`, source: 'system' });
    await notifyFamily(patient, {
      title: `⚠️ ${name} is away from ${label}`,
      body: `About ${formatDistance(distanceM)} away. If you are with them, open NestCare and tap "I'm with them".`,
      data: { type: 'wander', eventId: String(event._id) },
    }, { preference: PREF });
    return { action: 'open' };
  }

  if (next.action === 'reopen' && open) {
    open.status = 'active';
    open.lastLocation = point;
    open.lastSeenAt = now;
    open.maxDistanceM = Math.max(open.maxDistanceM || 0, distanceM);
    const alert = await Alert.create({
      patient: pid, type: 'away_from_zone', severity: 'critical', ref: `wander:${open._id}`,
      message: `${name} is still away from ${label} (${formatDistance(distanceM)} away). ${open.safeByName || 'A family member'} said they were together earlier.`.slice(0, 300),
    });
    open.alertId = alert._id;
    await open.save();
    await notifyFamily(patient, {
      title: `⚠️ ${name} is still away from ${label}`,
      body: `${open.safeByName || 'Someone'} confirmed they were together earlier. Please check that ${name} is still safe.`,
      data: { type: 'wander', eventId: String(open._id) },
    }, { preference: PREF });
    return { action: 'reopen' };
  }

  if (next.action === 'return' && open) {
    const wasUnconfirmed = open.status === 'active';
    open.open = false;
    open.status = 'returned';
    open.endedAt = now;
    open.lastLocation = point;
    open.lastSeenAt = now;
    await open.save();
    if (open.alertId) await Alert.updateOne({ _id: open.alertId, resolvedAt: null }, { resolvedAt: now, resolvedBy: 'system' });
    await Activity.create({ patient: pid, type: 'wander_return', message: `Back at ${open.zoneLabel || label}`, source: 'system' });
    // Only tell the family if they had been alerted and nobody had confirmed it
    if (wasUnconfirmed) {
      await notifyFamily(patient, {
        title: `✅ ${name} is back at ${open.zoneLabel || label}`,
        body: 'The away alert has been cleared automatically.',
        data: { type: 'wander_return', eventId: String(open._id) },
      }, { preference: PREF });
    }
    return { action: 'return' };
  }

  if (open) {
    await WanderEvent.updateOne({ _id: open._id }, { $set: { lastLocation: point, lastSeenAt: now }, $max: { maxDistanceM: distanceM } });
  }
  return { action: 'none' };
}

// Closes any open episode (tracking switched off, or the safe area was changed) and clears its alert
export async function endOpenEvents(patientId, now = new Date()) {
  const open = await WanderEvent.find({ patient: patientId, open: true });
  for (const e of open) {
    e.open = false;
    e.status = 'ended';
    e.endedAt = now;
    await e.save();
    if (e.alertId) await Alert.updateOne({ _id: e.alertId, resolvedAt: null }, { resolvedAt: now, resolvedBy: 'system' });
  }
  return open.length;
}
