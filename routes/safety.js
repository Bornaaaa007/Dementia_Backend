import express from 'express';
import mongoose from 'mongoose';
import TrustedContact from '../models/TrustedContact.js';
import SafetySettings from '../models/SafetySettings.js';
import SosEvent from '../models/SosEvent.js';
import Alert from '../models/Alert.js';
import { withPatient } from '../middleware/patientAccess.js';
import { readContact, readSettings, MAX_CONTACTS } from '../lib/sosInput.js';
import { withEffectiveStatus, serializeEvent } from '../lib/sosStatus.js';

// Mounted at /api/patients/:id/safety  (mergeParams makes :id visible here)
const router = express.Router({ mergeParams: true });

const fail = (res, err, code = 400) => res.status(code).json({ error: err.message || String(err) });

const serializeContact = (c) => ({ id: String(c._id), name: c.name, phone: c.phone, relationship: c.relationship || '' });
const serializeSettings = (s) => ({ shareLocationOnSos: s.shareLocationOnSos, emergencyNumber: s.emergencyNumber });

export async function getSettings(patientId) {
  return SafetySettings.findOneAndUpdate({ patient: patientId }, { $setOnInsert: { patient: patientId } }, { new: true, upsert: true });
}

// Everything the Safety screen needs
router.get('/', withPatient(), async (req, res) => {
  try {
    const pid = req.patient._id;
    const [settings, contacts, events] = await Promise.all([
      getSettings(pid),
      TrustedContact.find({ patient: pid }).sort({ createdAt: 1 }),
      SosEvent.find({ patient: pid }).sort({ createdAt: -1 }).limit(10),
    ]);
    const effective = await withEffectiveStatus(events);
    res.json({
      canManage: req.patientRole === 'owner',
      settings: serializeSettings(settings),
      contacts: contacts.map(serializeContact),
      events: effective.map(serializeEvent),
    });
  } catch (err) { fail(res, err, 500); }
});

// Location sharing and the emergency number (profile owner only)
router.put('/settings', withPatient('owner'), async (req, res) => {
  try {
    const update = readSettings(req.body);
    const settings = await SafetySettings.findOneAndUpdate(
      { patient: req.patient._id }, { $set: update, $setOnInsert: { patient: req.patient._id } }, { new: true, upsert: true }
    );
    res.json({ settings: serializeSettings(settings) });
  } catch (err) { fail(res, err); }
});

// Trusted contacts (profile owner only)
router.post('/contacts', withPatient('owner'), async (req, res) => {
  try {
    const fields = readContact(req.body);
    if ((await TrustedContact.countDocuments({ patient: req.patient._id })) >= MAX_CONTACTS) {
      return res.status(400).json({ error: `You can add up to ${MAX_CONTACTS} trusted contacts` });
    }
    const contact = await TrustedContact.create({ ...fields, patient: req.patient._id, createdBy: req.user.id });
    res.status(201).json({ contact: serializeContact(contact) });
  } catch (err) { fail(res, err); }
});

router.put('/contacts/:cid', withPatient('owner'), async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.cid)) return res.status(400).json({ error: 'Invalid contact id' });
    const contact = await TrustedContact.findOne({ _id: req.params.cid, patient: req.patient._id });
    if (!contact) return res.status(404).json({ error: 'Contact not found' });
    Object.assign(contact, readContact(req.body, { partial: true }));
    await contact.save();
    res.json({ contact: serializeContact(contact) });
  } catch (err) { fail(res, err); }
});

router.delete('/contacts/:cid', withPatient('owner'), async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.cid)) return res.status(400).json({ error: 'Invalid contact id' });
    const result = await TrustedContact.deleteOne({ _id: req.params.cid, patient: req.patient._id });
    if (!result.deletedCount) return res.status(404).json({ error: 'Contact not found' });
    res.json({ message: 'Deleted' });
  } catch (err) { fail(res, err, 500); }
});

// Any connected family member can acknowledge or close a help request
async function loadEvent(req, res) {
  if (!mongoose.isValidObjectId(req.params.eid)) {
    res.status(400).json({ error: 'Invalid request id' });
    return null;
  }
  const event = await SosEvent.findOne({ _id: req.params.eid, patient: req.patient._id });
  if (!event) res.status(404).json({ error: 'Request not found' });
  return event;
}

router.post('/events/:eid/acknowledge', withPatient(), async (req, res) => {
  try {
    const event = await loadEvent(req, res);
    if (!event) return;
    if (event.status === 'active') {
      event.status = 'acknowledged';
      event.acknowledgedBy = (req.user.name || 'Family').slice(0, 80);
      event.acknowledgedAt = new Date();
      await event.save();
    }
    res.json({ event: serializeEvent(event) });
  } catch (err) { fail(res, err, 500); }
});

router.post('/events/:eid/resolve', withPatient(), async (req, res) => {
  try {
    const event = await loadEvent(req, res);
    if (!event) return;
    if (['active', 'acknowledged'].includes(event.status)) {
      event.status = 'resolved';
      event.resolvedAt = new Date();
      await event.save();
      if (event.alertId) await Alert.updateOne({ _id: event.alertId, resolvedAt: null }, { resolvedAt: new Date(), resolvedBy: req.user.id });
    }
    res.json({ event: serializeEvent(event) });
  } catch (err) { fail(res, err, 500); }
});

export default router;