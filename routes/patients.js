import express from 'express';
import mongoose from 'mongoose';
import Patient from '../models/Patient.js';
import Activity from '../models/Activity.js';
import Reminder from '../models/Reminder.js';
import Alert from '../models/Alert.js';
import CaregiverSettings from '../models/CaregiverSettings.js';
import { withPatient, roleFor } from '../middleware/patientAccess.js';
import { uniqueCode } from '../lib/codes.js';
import { buildDashboard } from '../lib/dashboard.js';
import { buildDemoData } from '../lib/demoData.js';

const router = express.Router();
const DAY = 86400000;
const MAX_PHOTO_CHARS = 1_500_000;

function serialize(p, userId) {
  const role = roleFor(p, userId);
  const out = {
    id: String(p._id), name: p.name, age: p.age ?? null, dob: p.dob || '', photoUrl: p.photoUrl || null,
    role, memberCount: (p.members || []).length + 1, createdAt: p.createdAt,
  };
  if (role === 'owner') {
    out.inviteCode = p.inviteCode;
    out.pairCode = p.pairCode;
    out.deviceActive = !!p.pairedAt;
  }
  return out;
}

// Patients created before codes existed get codes the first time the owner loads them
async function ensureCodes(p) {
  let changed = false;
  if (!p.inviteCode) { p.inviteCode = await uniqueCode(Patient, 'inviteCode', 6); changed = true; }
  if (!p.pairCode) { p.pairCode = await uniqueCode(Patient, 'pairCode', 8); changed = true; }
  if (changed) await p.save();
}

function readProfile(body = {}, partial = false) {
  const out = {};
  if (body.name !== undefined || !partial) {
    const name = String(body.name ?? '').trim();
    if (!name) throw new Error('Patient name is required');
    out.name = name.slice(0, 80);
  }
  if (body.age !== undefined && body.age !== null && body.age !== '') {
    const age = Number(body.age);
    if (!Number.isFinite(age) || age < 0 || age > 130) throw new Error('Age must be between 0 and 130');
    out.age = age;
  }
  if (body.dob !== undefined) out.dob = String(body.dob || '').trim().slice(0, 40);
  if (body.photoUrl !== undefined) {
    const photo = body.photoUrl || undefined;
    if (photo && (!String(photo).startsWith('data:image/') || String(photo).length > MAX_PHOTO_CHARS)) {
      throw new Error('Photo must be a small image');
    }
    out.photoUrl = photo;
  }
  return out;
}

const fail = (res, err, code = 400) => res.status(code).json({ error: err.message || String(err) });

// ---------- list / create / join ----------
router.get('/', async (req, res) => {
  try {
    const patients = await Patient.find({ $or: [{ createdBy: req.user.id }, { members: req.user.id }] }).sort({ createdAt: 1 });
    for (const p of patients) if (p.createdBy === req.user.id) await ensureCodes(p);
    res.json({ patients: patients.map((p) => serialize(p, req.user.id)) });
  } catch (err) { fail(res, err, 500); }
});

router.post('/', async (req, res) => {
  try {
    const patient = await Patient.create({
      ...readProfile(req.body),
      createdBy: req.user.id,
      inviteCode: await uniqueCode(Patient, 'inviteCode', 6),
      pairCode: await uniqueCode(Patient, 'pairCode', 8),
    });
    res.status(201).json({ patient: serialize(patient, req.user.id) });
  } catch (err) { fail(res, err); }
});

router.post('/join', async (req, res) => {
  try {
    const code = String(req.body?.inviteCode || '').trim().toUpperCase();
    if (!code) return res.status(400).json({ error: 'Enter the invite code' });
    const patient = await Patient.findOne({ inviteCode: code });
    if (!patient) return res.status(404).json({ error: 'That invite code is not valid' });
    if (!roleFor(patient, req.user.id)) {
      patient.members.push(req.user.id);
      await patient.save();
    }
    res.json({ patient: serialize(patient, req.user.id) });
  } catch (err) { fail(res, err); }
});

// ---------- one patient ----------
router.get('/:id', withPatient(), async (req, res) => {
  if (req.patientRole === 'owner') await ensureCodes(req.patient);
  res.json({ patient: serialize(req.patient, req.user.id) });
});

router.put('/:id', withPatient('owner'), async (req, res) => {
  try {
    Object.assign(req.patient, readProfile(req.body, true));
    await req.patient.save();
    res.json({ patient: serialize(req.patient, req.user.id) });
  } catch (err) { fail(res, err); }
});

router.delete('/:id', withPatient('owner'), async (req, res) => {
  try {
    const pid = req.patient._id;
    await Promise.all([Activity.deleteMany({ patient: pid }), Reminder.deleteMany({ patient: pid }), Alert.deleteMany({ patient: pid })]);
    await req.patient.deleteOne();
    res.json({ message: 'Deleted' });
  } catch (err) { fail(res, err, 500); }
});

router.post('/:id/regenerate-codes', withPatient('owner'), async (req, res) => {
  try {
    req.patient.inviteCode = await uniqueCode(Patient, 'inviteCode', 6);
    req.patient.pairCode = await uniqueCode(Patient, 'pairCode', 8);
    req.patient.deviceTokenHash = undefined; // un-pairs the patient's device
    req.patient.pairedAt = undefined;
    await req.patient.save();
    res.json({ patient: serialize(req.patient, req.user.id) });
  } catch (err) { fail(res, err, 500); }
});

// ---------- dashboard ----------
router.get('/:id/dashboard', withPatient(), async (req, res) => {
  try {
    const now = new Date();
    const pid = req.patient._id;
    const tz = Number.isFinite(Number(req.query.tz)) ? Number(req.query.tz) : 0;
    const [activities, reminders, alerts, settings] = await Promise.all([
      Activity.find({ patient: pid, at: { $gte: new Date(now - 14 * DAY) } }).sort({ at: -1 }).limit(300).lean(),
      Reminder.find({ patient: pid, scheduledAt: { $gte: new Date(now - 8 * DAY), $lte: new Date(+now + 2 * DAY) } }).lean(),
      Alert.find({ patient: pid, $or: [{ resolvedAt: null }, { raisedAt: { $gte: new Date(now - 7 * DAY) } }] }).lean(),
      CaregiverSettings.findOne({ userId: req.user.id }).lean(),
    ]);
    const dashboard = buildDashboard({
      patient: { name: req.patient.name }, activities, reminders, alerts, settings: settings || {}, now, tzOffsetMinutes: tz,
    });
    res.json({ patient: serialize(req.patient, req.user.id), dashboard });
  } catch (err) { fail(res, err, 500); }
});

// ---------- quick actions ----------
router.post('/:id/activities', withPatient(), async (req, res) => {
  try {
    const type = req.body?.type;
    if (!['mood', 'note'].includes(type)) return res.status(400).json({ error: 'type must be mood or note' });
    const message = String(req.body?.message || '').trim().slice(0, 500);
    let value;
    if (type === 'mood') {
      value = Number(req.body?.value);
      if (!Number.isInteger(value) || value < 1 || value > 5) return res.status(400).json({ error: 'Mood must be 1 to 5' });
    } else if (!message) {
      return res.status(400).json({ error: 'Write a note first' });
    }
    const activity = await Activity.create({
      patient: req.patient._id, type, message, value, source: 'caregiver', createdBy: req.user.id,
    });
    res.status(201).json({ activity });
  } catch (err) { fail(res, err); }
});

router.post('/:id/reminders', withPatient(), async (req, res) => {
  try {
    const title = String(req.body?.title || '').trim();
    if (!title) return res.status(400).json({ error: 'Reminder needs a title' });
    const scheduledAt = new Date(req.body?.scheduledAt);
    if (Number.isNaN(scheduledAt.getTime())) return res.status(400).json({ error: 'Invalid time' });
    const kind = req.body?.kind === 'routine' ? 'routine' : 'medication';
    const reminder = await Reminder.create({ patient: req.patient._id, title: title.slice(0, 120), kind, scheduledAt, createdBy: req.user.id });
    res.status(201).json({ reminder });
  } catch (err) { fail(res, err); }
});

router.patch('/:id/reminders/:rid', withPatient(), async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.rid)) return res.status(400).json({ error: 'Invalid reminder id' });
    const status = req.body?.status;
    if (!['taken', 'missed', 'pending'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
    const reminder = await Reminder.findOneAndUpdate(
      { _id: req.params.rid, patient: req.patient._id },
      { status, actedAt: status === 'pending' ? null : new Date() },
      { new: true }
    );
    if (!reminder) return res.status(404).json({ error: 'Reminder not found' });
    res.json({ reminder });
  } catch (err) { fail(res, err); }
});

router.post('/:id/alerts/:aid/resolve', withPatient(), async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.aid)) return res.status(400).json({ error: 'Invalid alert id' });
    const alert = await Alert.findOneAndUpdate(
      { _id: req.params.aid, patient: req.patient._id, resolvedAt: null },
      { resolvedAt: new Date(), resolvedBy: req.user.id },
      { new: true }
    );
    if (!alert) return res.status(404).json({ error: 'Alert not found or already resolved' });
    res.json({ alert });
  } catch (err) { fail(res, err); }
});

// ---------- sample data (so the dashboard can be demonstrated) ----------
router.post('/:id/demo', withPatient('owner'), async (req, res) => {
  try {
    if (process.env.ALLOW_DEMO_DATA === 'false') return res.status(403).json({ error: 'Sample data is disabled' });
    const scenario = ['normal', 'stale', 'empty'].includes(req.body?.scenario) ? req.body.scenario : 'normal';
    const pid = req.patient._id;
    await Promise.all([Activity.deleteMany({ patient: pid, demo: true }), Reminder.deleteMany({ patient: pid, demo: true }), Alert.deleteMany({ patient: pid, demo: true })]);

    const tz = Number.isFinite(Number(req.body?.tz)) ? Number(req.body.tz) : 0;
    const data = buildDemoData({ scenario, now: new Date(), tzOffsetMinutes: tz, userId: req.user.id });
    const tag = (docs) => docs.map((d) => ({ ...d, patient: pid }));
    if (data.activities.length) await Activity.insertMany(tag(data.activities));
    if (data.reminders.length) await Reminder.insertMany(tag(data.reminders));
    if (data.alerts.length) await Alert.insertMany(tag(data.alerts));
    res.json({ scenario, activities: data.activities.length, reminders: data.reminders.length, alerts: data.alerts.length });
  } catch (err) { fail(res, err, 500); }
});

export default router;
