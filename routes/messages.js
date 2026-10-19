import express from 'express';
import mongoose from 'mongoose';
import Message from '../models/Message.js';
import { withPatient } from '../middleware/patientAccess.js';
import { readMessage, readKind } from '../lib/messageInput.js';

// Mounted at /api/patients/:id/messages  (mergeParams makes :id visible here)
const router = express.Router({ mergeParams: true });

const MAX_JAR_NOTES = 200;
const MAX_MESSAGES_PER_HOUR = 20; // simple guard so one account cannot flood the patient

const fail = (res, err, code = 400) => res.status(code).json({ error: err.message || String(err) });

// The profile owner can remove anything; other family members can remove what they sent
const canDelete = (req, m) => req.patientRole === 'owner' || m.senderId === req.user.id;

const serialize = (m, req) => ({
  id: String(m._id),
  kind: m.kind,
  text: m.text,
  senderName: m.senderName,
  sentAt: m.createdAt,
  read: !!m.readAt,
  readAt: m.readAt || null,
  canDelete: canDelete(req, m),
});

// List: GET /messages?kind=message (default) or ?kind=jar
router.get('/', withPatient(), async (req, res) => {
  try {
    const kind = readKind(req.query.kind);
    const items = await Message.find({ patient: req.patient._id, kind })
      .sort({ createdAt: -1 })
      .limit(kind === 'jar' ? MAX_JAR_NOTES : 50);
    res.json({ messages: items.map((m) => serialize(m, req)) });
  } catch (err) { fail(res, err, 500); }
});

// Send a message or add a jar note
router.post('/', withPatient(), async (req, res) => {
  try {
    const { kind, text } = readMessage(req.body);
    const pid = req.patient._id;

    if (kind === 'jar') {
      if ((await Message.countDocuments({ patient: pid, kind: 'jar' })) >= MAX_JAR_NOTES) {
        return res.status(400).json({ error: `The jar can hold up to ${MAX_JAR_NOTES} notes` });
      }
    } else {
      const recent = await Message.countDocuments({
        patient: pid, kind: 'message', senderId: req.user.id, createdAt: { $gte: new Date(Date.now() - 3600000) },
      });
      if (recent >= MAX_MESSAGES_PER_HOUR) {
        return res.status(429).json({ error: 'You have sent a lot of messages. Please wait a little before sending more.' });
      }
    }

    const message = await Message.create({
      patient: pid, kind, text, senderId: req.user.id, senderName: (req.user.name || 'Family').slice(0, 80),
    });
    res.status(201).json({ message: serialize(message, req) });
  } catch (err) { fail(res, err); }
});

// Delete
router.delete('/:mid', withPatient(), async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.mid)) return res.status(400).json({ error: 'Invalid message id' });
    const message = await Message.findOne({ _id: req.params.mid, patient: req.patient._id });
    if (!message) return res.status(404).json({ error: 'Not found' });
    if (!canDelete(req, message)) return res.status(403).json({ error: 'Only the profile owner or the sender can delete this' });
    await message.deleteOne();
    res.json({ message: 'Deleted' });
  } catch (err) { fail(res, err, 500); }
});

export default router;