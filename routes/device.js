import express from 'express';
import crypto from 'crypto';
import Patient from '../models/Patient.js';
import Activity from '../models/Activity.js';
import { requireDevice, hashToken } from '../middleware/requireDevice.js';

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

router.get('/me', requireDevice, (req, res) => res.json({ patient: publicPatient(req.devicePatient) }));

// "Patient opened the app" signal that feeds the family dashboard (recent activity + stale data)
router.post('/checkin', requireDevice, async (req, res) => {
  try {
    const last = await Activity.findOne({ patient: req.devicePatient._id, type: 'app_open', source: 'patient' }).sort({ at: -1 });
    if (last && Date.now() - last.at.getTime() < 10 * 60 * 1000) return res.json({ ok: true, skipped: true });
    await Activity.create({ patient: req.devicePatient._id, type: 'app_open', message: 'Opened the app', source: 'patient' });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/unpair', requireDevice, async (req, res) => {
  req.devicePatient.deviceTokenHash = undefined;
  req.devicePatient.pairedAt = undefined;
  await req.devicePatient.save();
  res.json({ ok: true });
});

export default router;
