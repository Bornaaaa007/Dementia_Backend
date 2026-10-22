import express from 'express';
import mongoose from 'mongoose';
import GalleryPhoto from '../models/GalleryPhoto.js';
import { withPatient } from '../middleware/patientAccess.js';
import { requireDevice } from '../middleware/requireDevice.js';

// Family routes: mounted at /api/patients/:id/gallery
export const galleryRouter = express.Router({ mergeParams: true });

const MAX_PHOTOS = 300;
const MAX_PHOTO_CHARS = 2_000_000; // a resized photo is far smaller; the JSON body limit is 3 MB
const fail = (res, err, code = 400) => res.status(code).json({ error: err.message || String(err) });
const canManage = (req, photo) => req.patientRole === 'owner' || photo.addedBy === req.user.id;

function readPhoto(body, { partial = false } = {}) {
  const { photoUrl, caption, takenAt, linkedMemory, linkedSong } = body;
  const fields = {};
  if (!partial || photoUrl !== undefined) {
    const photo = String(photoUrl || '').trim();
    if (!photo) throw new Error('Photo is required');
    // Only a real image is accepted, like the loved-ones cards. A file path from the phone is rejected.
    if (!photo.startsWith('data:image/') || photo.length > MAX_PHOTO_CHARS) {
      throw new Error('That photo could not be saved. Please choose it again.');
    }
    fields.photoUrl = photo;
  }
  if (caption  !== undefined) fields.caption  = (caption || '').trim().slice(0, 200);
  if (takenAt  !== undefined) fields.takenAt   = (takenAt || '').trim().slice(0, 30);
  if (linkedMemory !== undefined)
    fields.linkedMemory = linkedMemory && mongoose.isValidObjectId(linkedMemory) ? linkedMemory : null;
  if (linkedSong !== undefined)
    fields.linkedSong = linkedSong && mongoose.isValidObjectId(linkedSong) ? linkedSong : null;
  return fields;
}

function serialize(p) {
  return {
    id:           String(p._id),
    photoUrl:     p.photoUrl,
    caption:      p.caption || '',
    takenAt:      p.takenAt || '',
    linkedMemory: p.linkedMemory ? String(p.linkedMemory) : null,
    linkedSong:   p.linkedSong   ? String(p.linkedSong)   : null,
    addedBy:      p.addedBy,
    createdAt:    p.createdAt,
  };
}

// List
galleryRouter.get('/', withPatient(), async (req, res) => {
  try {
    const photos = await GalleryPhoto.find({ patient: req.patient._id }).sort({ createdAt: -1 });
    res.json({ photos: photos.map(serialize) });
  } catch (err) { fail(res, err, 500); }
});

// Add
galleryRouter.post('/', withPatient(), async (req, res) => {
  console.log('[gallery POST] photoUrl starts with:', String(req.body?.photoUrl).slice(0, 40));
  try {
    const fields = readPhoto(req.body);
    if ((await GalleryPhoto.countDocuments({ patient: req.patient._id })) >= MAX_PHOTOS)
      return res.status(400).json({ error: `You can add up to ${MAX_PHOTOS} photos` });
    const photo = await GalleryPhoto.create({ ...fields, patient: req.patient._id, addedBy: req.user.id });
    res.status(201).json({ photo: serialize(photo) });
  } catch (err) { fail(res, err); }
});

// Edit
galleryRouter.put('/:pid', withPatient(), async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.pid)) return res.status(400).json({ error: 'Invalid photo id' });
    const photo = await GalleryPhoto.findOne({ _id: req.params.pid, patient: req.patient._id });
    if (!photo) return res.status(404).json({ error: 'Photo not found' });
    if (!canManage(req, photo)) return res.status(403).json({ error: 'You cannot edit this photo' });
    Object.assign(photo, readPhoto(req.body, { partial: true }));
    await photo.save();
    res.json({ photo: serialize(photo) });
  } catch (err) { fail(res, err); }
});

// Delete
galleryRouter.delete('/:pid', withPatient(), async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.pid)) return res.status(400).json({ error: 'Invalid photo id' });
    const photo = await GalleryPhoto.findOne({ _id: req.params.pid, patient: req.patient._id });
    if (!photo) return res.status(404).json({ error: 'Photo not found' });
    if (!canManage(req, photo)) return res.status(403).json({ error: 'You cannot delete this photo' });
    await photo.deleteOne();
    res.json({ message: 'Deleted' });
  } catch (err) { fail(res, err, 500); }
});

// ---------------------------------------------------------------------------
// Not mounted anywhere: the patient's gallery is served by routes/device.js (GET /api/patient-device/gallery).
// Kept so existing imports keep working. requireDevice sets req.devicePatient, not req.patient.
// ---------------------------------------------------------------------------
export const patientGalleryRouter = express.Router();

patientGalleryRouter.get('/', requireDevice, async (req, res) => {
  try {
    const photos = await GalleryPhoto.find({ patient: req.devicePatient._id }).sort({ createdAt: -1 });
    res.json({ photos: photos.map(serialize) });
  } catch (err) { fail(res, err, 500); }
});