import express from 'express';
import mongoose from 'mongoose';
import Activity from '../models/Activity.js';
import Alert from '../models/Alert.js';
import PatientLocation from '../models/PatientLocation.js';
import SafetySettings from '../models/SafetySettings.js';
import WanderEvent from '../models/WanderEvent.js';
import { withPatient } from '../middleware/patientAccess.js';
import { classifyPing, STALE_AFTER_MS, SAFE_WINDOW_MS } from '../lib/geofence.js';
import { readLocationSettings, readSafeNote } from '../lib/locationInput.js';
import { endOpenEvents } from '../lib/wander.js';
import { notifyFamily } from '../lib/push.js';
import { getSettings } from './safety.js';

// Mounted at /api/patients/:id/location  (mergeParams makes :id visible here)
const router = express.Router({ mergeParams: true });

const fail = (res, err, code = 400) => res.status(code).json({ error: err.message || String(err) });

const serializeZone = (s) =>
  s.safeZone?.lat != null && s.safeZone?.lng != null
    ? { label: s.safeZone.label || 'Home', lat: s.safeZone.lat, lng: s.safeZone.lng, radiusM: s.safeZone.radiusM }
    : null;

function serializeLocation(loc, zone, now) {
  const ageMs = now.getTime() - loc.recordedAt.getTime();
  const base = { lat: loc.lat, lng: loc.lng, accuracy: loc.accuracy ?? null, recordedAt: loc.recordedAt, stale: ageMs > STALE_AFTER_MS };
  if (!zone) return { ...base, distanceM: null, where: 'unknown' };
  const { distanceM, where } = classifyPing(zone, loc);
  return { ...base, distanceM, where };
}

const serializeEvent = (e) => ({
  id: String(e._id),
  status: e.status,
  zoneLabel: e.zoneLabel || 'Home',
  startedAt: e.startedAt,
  lastSeenAt: e.lastSeenAt || null,
  lastLocation: e.lastLocation?.lat != null ? { lat: e.lastLocation.lat, lng: e.lastLocation.lng } : null,
  maxDistanceM: e.maxDistanceM || 0,
  safeByName: e.safeByName || null,
  safeAt: e.safeAt || null,
  safeNote: e.safeNote || '',
  endedAt: e.endedAt || null,
  safeUntil: e.status === 'safe' && e.safeAt ? new Date(e.safeAt.getTime() + SAFE_WINDOW_MS) : null,
});

// Everything the Location screen needs.
// The position is only returned while tracking is switched on, and only to family accounts of this patient.
router.get('/', withPatient(), async (req, res) => {
  try {
    const pid = req.patient._id;
    const now = new Date();
    const settings = await getSettings(pid);
    const zone = serializeZone(settings);

    let location = null;
    if (settings.trackingEnabled) {
      const loc = await PatientLocation.findOne({ patient: pid });
      if (loc) location = serializeLocation(loc, zone, now);
    }
    const events = await WanderEvent.find({ patient: pid }).sort({ startedAt: -1 }).limit(10);
    const current = events.find((e) => e.open) || null;

    res.json({
      canManage: req.patientRole === 'owner',
      patientName: req.patient.name,
      trackingEnabled: settings.trackingEnabled,
      safeZone: zone,
      location,
      activeEvent: current ? serializeEvent(current) : null,
      events: events.filter((e) => !e.open).map(serializeEvent),
    });
  } catch (err) { fail(res, err, 500); }
});

// Switch tracking on/off and set the safe area (profile owner only)
router.put('/settings', withPatient('owner'), async (req, res) => {
  try {
    const update = readLocationSettings(req.body);
    const pid = req.patient._id;
    const before = await getSettings(pid);

    const set = {};
    if (update.trackingEnabled !== undefined) set.trackingEnabled = update.trackingEnabled;
    if (update.safeZone) set.safeZone = update.safeZone;
    const after = Object.keys(set).length
      ? await SafetySettings.findOneAndUpdate({ patient: pid }, { $set: set, $setOnInsert: { patient: pid } }, { new: true, upsert: true })
      : before;

    const turnedOff = update.trackingEnabled === false && before.trackingEnabled;
    const z = before.safeZone || {};
    const zoneChanged = !!update.safeZone && (z.lat !== update.safeZone.lat || z.lng !== update.safeZone.lng || z.radiusM !== update.safeZone.radiusM);

    if (turnedOff) {
      await endOpenEvents(pid);
      await PatientLocation.deleteOne({ patient: pid }); // switching it off also forgets the last position
    } else if (zoneChanged) {
      await endOpenEvents(pid); // judge the patient against the new area from the next report
      await PatientLocation.updateOne({ patient: pid }, { $set: { outsideStreak: 0, insideStreak: 0 } });
    }

    res.json({ trackingEnabled: after.trackingEnabled, safeZone: serializeZone(after) });
  } catch (err) { fail(res, err); }
});

// "I'm with them, they're safe": any connected family member can send this.
// It dismisses the alert and tells everyone else.
router.post('/events/:eid/safe', withPatient(), async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.eid)) return res.status(400).json({ error: 'Invalid alert id' });
    let note;
    try { note = readSafeNote(req.body); } catch (e) { return res.status(400).json({ error: e.message }); }

    const pid = req.patient._id;
    const name = req.patient.name;
    const who = (req.user.name || 'A family member').slice(0, 80);
    const now = new Date();

    // only one person can win: if two caregivers tap at once, the second one is told who got there first
    const event = await WanderEvent.findOneAndUpdate(
      { _id: req.params.eid, patient: pid, open: true, status: 'active' },
      { status: 'safe', safeBy: req.user.id, safeByName: who, safeAt: now, safeNote: note },
      { new: true }
    );
    if (!event) {
      const existing = await WanderEvent.findOne({ _id: req.params.eid, patient: pid });
      if (!existing) return res.status(404).json({ error: 'Alert not found' });
      const error = existing.status === 'safe'
        ? `${existing.safeByName || 'A family member'} already confirmed that ${name} is safe`
        : `${name} is already back, so this alert has ended`;
      return res.status(409).json({ error, event: serializeEvent(existing) });
    }

    if (event.alertId) await Alert.updateOne({ _id: event.alertId, resolvedAt: null }, { resolvedAt: now, resolvedBy: req.user.id });
    await Activity.create({
      patient: pid, type: 'location_safe', source: 'caregiver', createdBy: req.user.id,
      message: `${who} is with ${name} (safe)${note ? `: ${note}` : ''}`.slice(0, 500),
    });
    await notifyFamily(req.patient, {
      title: `✅ ${name} is safe`,
      body: `${who} is with ${name} right now.${note ? ` "${note}"` : ''}`,
      data: { type: 'wander_safe', eventId: String(event._id) },
    }, { exceptUserId: req.user.id, preference: 'notifyLocationAlerts' });

    res.json({ event: serializeEvent(event) });
  } catch (err) { fail(res, err, 500); }
});

export default router;
