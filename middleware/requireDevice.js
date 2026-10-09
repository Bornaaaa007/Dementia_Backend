import crypto from 'crypto';
import Patient from '../models/Patient.js';

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
