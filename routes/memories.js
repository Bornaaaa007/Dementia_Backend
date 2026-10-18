import express from 'express';
import mongoose from 'mongoose';
import Memory from '../models/Memory.js';
import { withPatient } from '../middleware/patientAccess.js';
import { readMemory } from '../lib/memoryInput.js';

// Mounted at /api/patients/:id/memories  (mergeParams makes :id visible here)
const router = express.Router({ mergeParams: true });
const MAX_PER_PATIENT = 100;

const fail = (res, err, code = 400) => res.status(code).json({ error: err.message || String(err) });

// Owner can manage every card; a family member can manage the cards they added themselves
const canManage = (req, memory) => req.patientRole === 'owner' || memory.createdBy === req.user.id;

function serialize(m, req) {
  return {
    id: String(m._id),
    name: m.name,
    relationship: m.relationship,
    story: m.story || '',
    photoUrl: m.photoUrl || null,
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
    canEdit: canManage(req, m),
  };
}

async function loadMemory(req, res) {
  if (!mongoose.isValidObjectId(req.params.mid)) {
    res.status(400).json({ error: 'Invalid memory id' });
    return null;
  }
  const memory = await Memory.findOne({ _id: req.params.mid, patient: req.patient._id });
  if (!memory) res.status(404).json({ error: 'Memory not found' });
  return memory;
}

// Browse
router.get('/', withPatient(), async (req, res) => {
  try {
    const memories = await Memory.find({ patient: req.patient._id }).collation({ locale: 'en', strength: 2 }).sort({ name: 1 });
    res.json({ memories: memories.map((m) => serialize(m, req)) });
  } catch (err) { fail(res, err, 500); }
});

router.get('/:mid', withPatient(), async (req, res) => {
  try {
    const memory = await loadMemory(req, res);
    if (memory) res.json({ memory: serialize(memory, req) });
  } catch (err) { fail(res, err, 500); }
});

// Create
router.post('/', withPatient(), async (req, res) => {
  try {
    const fields = readMemory(req.body);
    if ((await Memory.countDocuments({ patient: req.patient._id })) >= MAX_PER_PATIENT) {
      return res.status(400).json({ error: `You can add up to ${MAX_PER_PATIENT} loved ones` });
    }
    const memory = await Memory.create({ ...fields, patient: req.patient._id, createdBy: req.user.id });
    res.status(201).json({ memory: serialize(memory, req) });
  } catch (err) { fail(res, err); }
});

// Edit
router.put('/:mid', withPatient(), async (req, res) => {
  try {
    const memory = await loadMemory(req, res);
    if (!memory) return;
    if (!canManage(req, memory)) return res.status(403).json({ error: 'Only the profile owner or the person who added this card can change it' });
    Object.assign(memory, readMemory(req.body, { partial: true }));
    await memory.save();
    res.json({ memory: serialize(memory, req) });
  } catch (err) { fail(res, err); }
});

// Delete
router.delete('/:mid', withPatient(), async (req, res) => {
  try {
    const memory = await loadMemory(req, res);
    if (!memory) return;
    if (!canManage(req, memory)) return res.status(403).json({ error: 'Only the profile owner or the person who added this card can delete it' });
    await memory.deleteOne();
    res.json({ message: 'Deleted' });
  } catch (err) { fail(res, err, 500); }
});

export default router;