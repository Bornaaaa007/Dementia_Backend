import crypto from 'crypto';
import Patient from '../models/Patient.js';
import { verifySession } from '../lib/patientSession.js';

export const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

// Patient device: "Authorization: Bearer <device token>" from the pairing step
export async function requireDevice(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!token) return res.status(401).json({ error: 'Device not paired', code: 'NO_DEVICE' });

    const patient = await Patient.findOne({ deviceTokenHash: hashToken(token) }).select('+deviceTokenHash');
    if (!patient) return res.status(401).json({ error: 'Device not paired', code: 'NO_DEVICE' });
    req.devicePatient = patient;
    next();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// Device token AND a recent face check ("X-Patient-Session" header from /face-login)
export function requireFaceSession(req, res, next) {
  requireDevice(req, res, () => {
    if (!verifySession(req.headers['x-patient-session'], req.devicePatient._id)) {
      return res.status(401).json({ error: 'Please unlock with your face', code: 'FACE_REQUIRED' });
    }
    next();
  });
}