import express from 'express';
import crypto from 'crypto';
import Patient from '../models/Patient.js';
import Activity from '../models/Activity.js';
import { requireDevice, requireFaceSession, hashToken } from '../middleware/requireDevice.js';
import { getDescriptor, bestDistance, FaceError, THRESHOLD } from '../lib/face.js';
import { signSession } from '../lib/patientSession.js';
import Memory from '../models/Memory.js';
import mongoose from 'mongoose';
import Message from '../models/Message.js';

const router = express.Router();

// very small in-memory limiter for pairing attempts (per IP)
const attempts = new Map();
function tooManyAttempts(ip) {
  const now = Date.now();
  const recent = (attempts.get(ip) || []).filter((t) => now - t < 10 * 60 * 1000);
  recent.push(now);
  attempts.set(ip, recent);
  return recent.length > 10;
}

// failed face matches per patient
const faceFails = new Map();
const MAX_FACE_FAILS = 5;
const FACE_WINDOW = 10 * 60 * 1000;
function recentFaceFails(id) {
  const now = Date.now();
  const list = (faceFails.get(id) || []).filter((t) => now - t < FACE_WINDOW);
  faceFails.set(id, list);
  return list;
}

const publicPatient = (p) => ({ id: String(p._id), name: p.name, photoUrl: p.photoUrl || null });

// The patient's own device enters the pairing code once and receives a device token
router.post('/pair', async (req, res) => {
  try {
    if (tooManyAttempts(req.ip)) return res.status(429).json({ error: 'Too many attempts, try again in a few minutes' });
    const code = String(req.body?.pairCode || '').trim().toUpperCase();
    if (!code) return res.status(400).json({ error: 'Enter the pairing code' });
    const patient = await Patient.findOne({ pairCode: code });
    if (!patient) return res.status(404).json({ error: 'That pairing code is not valid' });

    const token = crypto.randomBytes(32).toString('hex'); // pairing again replaces the old device
    patient.deviceTokenHash = hashToken(token);
    patient.pairedAt = new Date();
    await patient.save();
    res.json({ token, patient: publicPatient(patient) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Used by the lock screen, before the face check
router.get('/me', requireDevice, (req, res) => res.json({ patient: publicPatient(req.devicePatient) }));

// Face check: compares a live photo with the saved descriptors and, on a match, issues a short session token
router.post('/face-login', requireDevice, async (req, res) => {
  const pid = String(req.devicePatient._id);
  try {
    if (recentFaceFails(pid).length >= MAX_FACE_FAILS) {
      return res.status(429).json({ error: 'Too many tries. Please ask your family for help.', code: 'FACE_LOCKED' });
    }

       const patient = await Patient.findById(pid).select('+faceDescriptors');
    console.log('[face-login] patient:', pid, patient.name, 'saved faces:', patient.faceDescriptors?.length);
    if (!patient.faceDescriptors?.length) {
      return res.status(409).json({ error: "Face unlock isn't set up yet. Please ask your family.", code: 'FACE_NOT_ENROLLED' });
    }

    const descriptor = await getDescriptor(req.body?.image);
    const enrolled = patient.faceDescriptors.map((d) => Array.from(d));
    if (bestDistance(descriptor, enrolled) > THRESHOLD) {
      const list = recentFaceFails(pid);
      list.push(Date.now());
      return res.status(401).json({
        error: "That doesn't look like you. Let's try again.",
        code: 'FACE_NO_MATCH',
        attemptsLeft: Math.max(0, MAX_FACE_FAILS - list.length),
      });
    }

    faceFails.delete(pid);
    const { token, expiresAt } = signSession(pid);
    res.json({ sessionToken: token, expiresAt });
  } catch (e) {
    if (e instanceof FaceError) return res.status(422).json({ error: e.message, code: e.code });
    console.error('[face] login error:', e.message);
    res.status(500).json({ error: 'Face check is not available right now' });
  }
});

// "Patient opened the app" signal that feeds the family dashboard. Needs the face check.
router.post('/checkin', requireFaceSession, async (req, res) => {
  try {
    const last = await Activity.findOne({ patient: req.devicePatient._id, type: 'app_open', source: 'patient' }).sort({ at: -1 });
    if (last && Date.now() - last.at.getTime() < 10 * 60 * 1000) return res.json({ ok: true, skipped: true });
    await Activity.create({ patient: req.devicePatient._id, type: 'app_open', message: 'Opened the app', source: 'patient' });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
// Week 5: the patient's device can only READ its own patient's memory cards
router.get('/memories', requireDevice, async (req, res) => {
  try {
    const memories = await Memory.find({ patient: req.devicePatient._id }).collation({ locale: 'en', strength: 2 }).sort({ name: 1 });
    res.json({
      memories: memories.map((m) => ({
        id: String(m._id), name: m.name, relationship: m.relationship, story: m.story || '', photoUrl: m.photoUrl || null,
      })),
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
// Week 6: messages from family (read-only list + "Got it" read state)
router.get('/messages', requireDevice, async (req, res) => {
  try {
    const items = await Message.find({ patient: req.devicePatient._id, kind: 'message' }).sort({ createdAt: -1 }).limit(20);
    res.json({
      unread: items.filter((m) => !m.readAt).length,
      messages: items.map((m) => ({ id: String(m._id), text: m.text, senderName: m.senderName, sentAt: m.createdAt, read: !!m.readAt })),
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/messages/:mid/read', requireDevice, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.mid)) return res.status(400).json({ error: 'Invalid message id' });
    // only the first tap changes anything, so repeated taps are harmless
    const message = await Message.findOneAndUpdate(
      { _id: req.params.mid, patient: req.devicePatient._id, kind: 'message', readAt: null },
      { readAt: new Date() },
      { new: true }
    );
    if (message) {
      await Activity.create({ patient: req.devicePatient._id, type: 'message_read', message: `Read a message from ${message.senderName}`, source: 'patient' });
    }
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Week 6: Compliment & Encouragement Jar. Shows one random note and counts as a light check-in.
router.post('/jar/reveal', requireDevice, async (req, res) => {
  try {
    const pid = req.devicePatient._id;
    const total = await Message.countDocuments({ patient: pid, kind: 'jar' });
    if (!total) return res.json({ note: null, total: 0 });

    // avoid showing the same note twice in a row when there is more than one
    const lastId = mongoose.isValidObjectId(req.body?.lastId) ? new mongoose.Types.ObjectId(req.body.lastId) : null;
    const match = { patient: pid, kind: 'jar', ...(lastId && total > 1 ? { _id: { $ne: lastId } } : {}) };
    const [note] = await Message.aggregate([{ $match: match }, { $sample: { size: 1 } }]);
    if (!note) return res.json({ note: null, total });

    await Message.updateOne({ _id: note._id }, { $inc: { revealCount: 1 }, $set: { lastRevealedAt: new Date() } });

    // one check-in entry per 5 minutes, so tapping "another note" does not flood the activity list
    const last = await Activity.findOne({ patient: pid, type: 'jar', source: 'patient' }).sort({ at: -1 });
    if (!last || Date.now() - last.at.getTime() > 5 * 60 * 1000) {
      await Activity.create({ patient: pid, type: 'jar', message: 'Opened a kind note from the jar', source: 'patient' });
    }
    res.json({ note: { id: String(note._id), text: note.text, senderName: note.senderName }, total });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
router.delete('/unpair', requireDevice, async (req, res) => {
  req.devicePatient.deviceTokenHash = undefined;
  req.devicePatient.pairedAt = undefined;
  await req.devicePatient.save();
  res.json({ ok: true });
});

export default router;