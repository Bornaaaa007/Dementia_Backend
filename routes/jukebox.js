import express from 'express';
import mongoose from 'mongoose';
import Song from '../models/Song.js';
import { withPatient } from '../middleware/patientAccess.js';
import { requireDevice } from '../middleware/requireDevice.js';

// Family routes: mounted at /api/patients/:id/jukebox  (requireAuth applied in server.js)
export const jukeboxRouter = express.Router({ mergeParams: true });

const MAX_SONGS = 200;
const fail = (res, err, code = 400) => res.status(code).json({ error: err.message || String(err) });
const canManage = (req, song) => req.patientRole === 'owner' || song.addedBy === req.user.id;

function readSong(body, { partial = false } = {}) {
  const { title, artist, audioUrl, linkedMemory, note } = body;
  const fields = {};
  if (!partial || title     !== undefined) {
    if (!title?.trim()) throw new Error('Song title is required');
    fields.title = title.trim().slice(0, 120);
  }
  if (artist     !== undefined) fields.artist        = (artist || '').trim().slice(0, 80);
  if (audioUrl   !== undefined) fields.audioUrl      = audioUrl || null;
  if (linkedMemory !== undefined) {
    fields.linkedMemory = linkedMemory && mongoose.isValidObjectId(linkedMemory) ? linkedMemory : null;
  }
  if (note !== undefined) fields.note = (note || '').trim().slice(0, 300);
  return fields;
}

function serialize(s) {
  return {
    id:            String(s._id),
    title:         s.title,
    artist:        s.artist || '',
    audioUrl:      s.audioUrl || null,
    linkedMemory:  s.linkedMemory ? String(s.linkedMemory) : null,
    note:          s.note || '',
    playCount:     s.playCount,
    lastPlayedAt:  s.lastPlayedAt,
    addedBy:       s.addedBy,
    createdAt:     s.createdAt,
  };
}

// List
jukeboxRouter.get('/', withPatient(), async (req, res) => {
  try {
    const songs = await Song.find({ patient: req.patient._id }).sort({ title: 1 }).collation({ locale: 'en', strength: 2 });
    res.json({ songs: songs.map(serialize) });
  } catch (err) { fail(res, err, 500); }
});

// Add
jukeboxRouter.post('/', withPatient(), async (req, res) => {
  try {
    const fields = readSong(req.body);
    if ((await Song.countDocuments({ patient: req.patient._id })) >= MAX_SONGS)
      return res.status(400).json({ error: `You can add up to ${MAX_SONGS} songs` });
    const song = await Song.create({ ...fields, patient: req.patient._id, addedBy: req.user.id });
    res.status(201).json({ song: serialize(song) });
  } catch (err) { fail(res, err); }
});

// Edit
jukeboxRouter.put('/:sid', withPatient(), async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.sid)) return res.status(400).json({ error: 'Invalid song id' });
    const song = await Song.findOne({ _id: req.params.sid, patient: req.patient._id });
    if (!song) return res.status(404).json({ error: 'Song not found' });
    if (!canManage(req, song)) return res.status(403).json({ error: 'You cannot edit this song' });
    Object.assign(song, readSong(req.body, { partial: true }));
    await song.save();
    res.json({ song: serialize(song) });
  } catch (err) { fail(res, err); }
});

// Delete
jukeboxRouter.delete('/:sid', withPatient(), async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.sid)) return res.status(400).json({ error: 'Invalid song id' });
    const song = await Song.findOne({ _id: req.params.sid, patient: req.patient._id });
    if (!song) return res.status(404).json({ error: 'Song not found' });
    if (!canManage(req, song)) return res.status(403).json({ error: 'You cannot delete this song' });
    await song.deleteOne();
    res.json({ message: 'Deleted' });
  } catch (err) { fail(res, err, 500); }
});

// ---------------------------------------------------------------------------
// Patient device routes: mounted at /api/patient-device/jukebox
// ---------------------------------------------------------------------------
export const patientJukeboxRouter = express.Router();

// List songs for the patient (no audio blobs to keep payload small — patient fetches one at a time)
patientJukeboxRouter.get('/', requireDevice, async (req, res) => {
  try {
    const songs = await Song.find({ patient: req.patient._id })
      .select('-audioUrl') // omit the heavy field from the list
      .sort({ title: 1 })
      .collation({ locale: 'en', strength: 2 });
    res.json({ songs: songs.map(s => ({ id: String(s._id), title: s.title, artist: s.artist, note: s.note, linkedMemory: s.linkedMemory ? String(s.linkedMemory) : null })) });
  } catch (err) { fail(res, err, 500); }
});

// Fetch a single song WITH audio so the patient can play it
patientJukeboxRouter.get('/:sid', requireDevice, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.sid)) return res.status(400).json({ error: 'Invalid song id' });
    const song = await Song.findOne({ _id: req.params.sid, patient: req.patient._id });
    if (!song) return res.status(404).json({ error: 'Song not found' });
    // log the play
    song.playCount += 1;
    song.lastPlayedAt = new Date();
    await song.save();
    res.json({ song: serialize(song) });
  } catch (err) { fail(res, err, 500); }
});