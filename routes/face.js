import express from 'express';
import Patient from '../models/Patient.js';
import { getDescriptor, FaceError } from '../lib/face.js';

const router = express.Router();
const MAX_PHOTOS = 5;

const fail = (res, e) => {
  if (e instanceof FaceError) return res.status(422).json({ error: e.message, code: e.code });
  console.error('[face] enroll error:', e.message);
  res.status(500).json({ error: 'Could not process the photo' });
};

// Is face unlock set up? (never returns the descriptors)
router.get('/', async (req, res) => {
  const p = await Patient.findById(req.patient._id).select('+faceDescriptors');
  res.json({ enrolled: p.faceDescriptors.length > 0, count: p.faceDescriptors.length, enrolledAt: p.faceEnrolledAt || null });
});

// Add one face photo. The photo is turned into numbers and thrown away.
router.post('/', async (req, res) => {
  try {
    const p = await Patient.findById(req.patient._id).select('+faceDescriptors');
    if (!p.faceConsentAt && req.body?.consent !== true) {
      return res.status(400).json({ error: 'Consent is needed to save a face scan', code: 'CONSENT_REQUIRED' });
    }
    if (p.faceDescriptors.length >= MAX_PHOTOS) {
      return res.status(400).json({ error: `Up to ${MAX_PHOTOS} face photos can be saved. Remove them first to start again.`, code: 'FACE_LIMIT' });
    }
    const descriptor = await getDescriptor(req.body?.image);
    p.faceDescriptors.push(descriptor);
    p.markModified('faceDescriptors');
    p.faceEnrolledAt = new Date();
    if (!p.faceConsentAt) p.faceConsentAt = new Date();
    await p.save();
    res.json({ ok: true, count: p.faceDescriptors.length });
  } catch (e) {
    fail(res, e);
  }
});

// Remove all face data (also withdraws consent)
router.delete('/', async (req, res) => {
  const p = await Patient.findById(req.patient._id).select('+faceDescriptors');
  p.faceDescriptors = [];
  p.faceEnrolledAt = undefined;
  p.faceConsentAt = undefined;
  await p.save();
  res.json({ ok: true });
});

export default router;