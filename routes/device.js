import express from 'express';
import crypto from 'crypto';
import mongoose from 'mongoose';
import Patient from '../models/Patient.js';
import Activity from '../models/Activity.js';
import Memory from '../models/Memory.js';
import Message from '../models/Message.js';
import Song from '../models/Song.js';
import GalleryPhoto from '../models/GalleryPhoto.js';
import { requireDevice, requireFaceSession, hashToken } from '../middleware/requireDevice.js';
import { getDescriptor, bestDistance, FaceError, THRESHOLD } from '../lib/face.js';
import { signSession } from '../lib/patientSession.js';
import Alert from '../models/Alert.js';
import CaregiverSettings from '../models/CaregiverSettings.js';
import Reminder from '../models/Reminder.js';
import Schedule from '../models/Schedule.js';
import { MOOD_LABELS, effectiveStatus, localDateKey, localDayStart } from '../lib/dashboard.js';
import { afterTaken, generateReminders } from '../lib/schedule.js';


const router = express.Router();

// ── rate limiting helpers ────────────────────────────────────────────────────
const attempts = new Map();
function tooManyAttempts(ip) {
  const now = Date.now();
  const recent = (attempts.get(ip) || []).filter((t) => now - t < 10 * 60 * 1000);
  recent.push(now);
  attempts.set(ip, recent);
  return recent.length > 10;
}

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

// ── Pairing ──────────────────────────────────────────────────────────────────
router.post('/pair', async (req, res) => {
  try {
    if (tooManyAttempts(req.ip)) return res.status(429).json({ error: 'Too many attempts, try again in a few minutes' });
    const code = String(req.body?.pairCode || '').trim().toUpperCase();
    if (!code) return res.status(400).json({ error: 'Enter the pairing code' });
    const patient = await Patient.findOne({ pairCode: code });
    if (!patient) return res.status(404).json({ error: 'That pairing code is not valid' });
    const token = crypto.randomBytes(32).toString('hex');
    patient.deviceTokenHash = hashToken(token);
    patient.pairedAt = new Date();
    await patient.save();
    res.json({ token, patient: publicPatient(patient) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/me', requireDevice, (req, res) => res.json({ patient: publicPatient(req.devicePatient) }));

// ── Face login ───────────────────────────────────────────────────────────────
router.post('/face-login', requireDevice, async (req, res) => {
  const pid = String(req.devicePatient._id);
  try {
    if (recentFaceFails(pid).length >= MAX_FACE_FAILS)
      return res.status(429).json({ error: 'Too many tries. Please ask your family for help.', code: 'FACE_LOCKED' });

    const patient = await Patient.findById(pid).select('+faceDescriptors');
    if (!patient.faceDescriptors?.length)
      return res.status(409).json({ error: "Face unlock isn't set up yet. Please ask your family.", code: 'FACE_NOT_ENROLLED' });

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

// ── Check-in ─────────────────────────────────────────────────────────────────
router.post('/checkin', requireFaceSession, async (req, res) => {
  try {
    const last = await Activity.findOne({ patient: req.devicePatient._id, type: 'app_open', source: 'patient' }).sort({ at: -1 });
    if (last && Date.now() - last.at.getTime() < 10 * 60 * 1000) return res.json({ ok: true, skipped: true });
    await Activity.create({ patient: req.devicePatient._id, type: 'app_open', message: 'Opened the app', source: 'patient' });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Week 5: Memories (read-only) ─────────────────────────────────────────────
router.get('/memories', requireDevice, async (req, res) => {
  try {
    const memories = await Memory.find({ patient: req.devicePatient._id })
      .collation({ locale: 'en', strength: 2 }).sort({ name: 1 });
    res.json({
      memories: memories.map((m) => ({
        id: String(m._id), name: m.name, relationship: m.relationship,
        story: m.story || '', photoUrl: m.photoUrl || null,
      })),
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Week 6: Messages ──────────────────────────────────────────────────────────
router.get('/messages', requireDevice, async (req, res) => {
  try {
    const items = await Message.find({ patient: req.devicePatient._id, kind: 'message' }).sort({ createdAt: -1 }).limit(20);
    res.json({
      unread: items.filter((m) => !m.readAt).length,
      messages: items.map((m) => ({
        id: String(m._id), text: m.text, senderName: m.senderName,
        sentAt: m.createdAt, read: !!m.readAt,
      })),
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/messages/:mid/read', requireDevice, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.mid)) return res.status(400).json({ error: 'Invalid message id' });
    const message = await Message.findOneAndUpdate(
      { _id: req.params.mid, patient: req.devicePatient._id, kind: 'message', readAt: null },
      { readAt: new Date() },
      { new: true }
    );
    if (message) {
      await Activity.create({
        patient: req.devicePatient._id, type: 'message_read',
        message: `Read a message from ${message.senderName}`, source: 'patient',
      });
    }
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Week 6: Jar ───────────────────────────────────────────────────────────────
router.post('/jar/reveal', requireDevice, async (req, res) => {
  try {
    const pid = req.devicePatient._id;
    const total = await Message.countDocuments({ patient: pid, kind: 'jar' });
    if (!total) return res.json({ note: null, total: 0 });
    const lastId = mongoose.isValidObjectId(req.body?.lastId) ? new mongoose.Types.ObjectId(req.body.lastId) : null;
    const match = { patient: pid, kind: 'jar', ...(lastId && total > 1 ? { _id: { $ne: lastId } } : {}) };
    const [note] = await Message.aggregate([{ $match: match }, { $sample: { size: 1 } }]);
    if (!note) return res.json({ note: null, total });
    await Message.updateOne({ _id: note._id }, { $inc: { revealCount: 1 }, $set: { lastRevealedAt: new Date() } });
    const last = await Activity.findOne({ patient: pid, type: 'jar', source: 'patient' }).sort({ at: -1 });
    if (!last || Date.now() - last.at.getTime() > 5 * 60 * 1000) {
      await Activity.create({ patient: pid, type: 'jar', message: 'Opened a kind note from the jar', source: 'patient' });
    }
    res.json({ note: { id: String(note._id), text: note.text, senderName: note.senderName }, total });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Week 7: Jukebox ───────────────────────────────────────────────────────────
// List songs (no audioUrl to keep payload small)
router.get('/jukebox', requireDevice, async (req, res) => {
  try {
    const songs = await Song.find({ patient: req.devicePatient._id })
      .select('-audioUrl')
      .sort({ title: 1 })
      .collation({ locale: 'en', strength: 2 });
    res.json({
      songs: songs.map((s) => ({
        id: String(s._id), title: s.title, artist: s.artist || '',
        note: s.note || '', linkedMemory: s.linkedMemory ? String(s.linkedMemory) : null,
      })),
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Fetch single song WITH audio + log the play
router.get('/jukebox/:sid', requireDevice, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.sid)) return res.status(400).json({ error: 'Invalid song id' });
    const song = await Song.findOne({ _id: req.params.sid, patient: req.devicePatient._id });
    if (!song) return res.status(404).json({ error: 'Song not found' });
    song.playCount = (song.playCount || 0) + 1;
    song.lastPlayedAt = new Date();
    await song.save();
    res.json({
      song: {
        id: String(song._id), title: song.title, artist: song.artist || '',
        audioUrl: song.audioUrl || null, note: song.note || '',
        linkedMemory: song.linkedMemory ? String(song.linkedMemory) : null,
        playCount: song.playCount, lastPlayedAt: song.lastPlayedAt,
      },
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Week 7: Gallery ───────────────────────────────────────────────────────────
router.get('/gallery', requireDevice, async (req, res) => {
  try {
    const photos = await GalleryPhoto.find({ patient: req.devicePatient._id }).sort({ createdAt: -1 });
    res.json({
      photos: photos.map((p) => ({
        id: String(p._id), photoUrl: p.photoUrl, caption: p.caption || '',
        takenAt: p.takenAt || '',
        linkedMemory: p.linkedMemory ? String(p.linkedMemory) : null,
        linkedSong:   p.linkedSong   ? String(p.linkedSong)   : null,
        createdAt: p.createdAt,
      })),
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Week 7: Daily Joy Button ──────────────────────────────────────────────────
router.post('/joy/reveal', requireDevice, async (req, res) => {
  try {
    const pid = req.devicePatient._id;
    const [songCount, photoCount] = await Promise.all([
      Song.countDocuments({ patient: pid }),
      GalleryPhoto.countDocuments({ patient: pid }),
    ]);
    const total = songCount + photoCount;
    if (total === 0) return res.json({ item: null, reason: 'empty' });

    const pick = Math.floor(Math.random() * total);
    if (pick < songCount) {
      const songs = await Song.find({ patient: pid }).select('title artist note linkedMemory');
      const song = songs[Math.floor(Math.random() * songs.length)];
      return res.json({
        item: {
          kind: 'song', id: String(song._id), title: song.title,
          artist: song.artist || '', note: song.note || '',
          linkedMemory: song.linkedMemory ? String(song.linkedMemory) : null,
        },
      });
    } else {
      const photos = await GalleryPhoto.find({ patient: pid }).select('photoUrl caption takenAt linkedMemory linkedSong');
      const photo = photos[Math.floor(Math.random() * photos.length)];
      return res.json({
        item: {
          kind: 'photo', id: String(photo._id), photoUrl: photo.photoUrl,
          caption: photo.caption || '', takenAt: photo.takenAt || '',
          linkedMemory: photo.linkedMemory ? String(photo.linkedMemory) : null,
          linkedSong:   photo.linkedSong   ? String(photo.linkedSong)   : null,
        },
      });
    }
  } catch (err) { res.status(500).json({ error: err.message }); }
});


// ── Week 8: today's medicines and routines ───────────────────────────────────
const DAY = 86400000;
const HOUR = 3600000;
const tzOf = (req) => (Number.isFinite(Number(req.query.tz)) ? Number(req.query.tz) : 0);

router.get('/today', requireFaceSession, async (req, res) => {
  try {
    const pid = req.devicePatient._id;
    const now = new Date();
    const schedules = await Schedule.find({ patient: pid, active: true });
    await Promise.all(schedules.map((s) => generateReminders(s, now)));

    const start = localDayStart(now, tzOf(req)).getTime();
    const reminders = await Reminder.find({
      patient: pid, scheduledAt: { $gte: new Date(start), $lt: new Date(start + DAY) },
    }).sort({ scheduledAt: 1 });
    const byId = new Map(schedules.map((s) => [String(s._id), s]));

    res.json({
      items: reminders.map((r) => {
        const t = r.scheduledAt.getTime();
        return {
          id: String(r._id), title: r.title, kind: r.kind, scheduledAt: r.scheduledAt,
          status: effectiveStatus(r, now), actedAt: r.actedAt || null,
          dose: byId.get(String(r.schedule))?.dose || '',
          // can be confirmed from 1 hour before until 4 hours after; later than that, ask the family
          canTake: t <= now.getTime() + HOUR && now.getTime() - t <= 4 * HOUR,
        };
      }),
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/reminders/:rid/done', requireFaceSession, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.rid)) return res.status(400).json({ error: 'Invalid reminder id' });
    const pid = req.devicePatient._id;
    const reminder = await Reminder.findOne({ _id: req.params.rid, patient: pid });
    if (!reminder) return res.status(404).json({ error: 'Reminder not found' });
    if (reminder.status === 'taken') return res.json({ ok: true, already: true });

    const t = reminder.scheduledAt.getTime();
    if (t > Date.now() + HOUR) return res.status(409).json({ error: "It's not time yet.", code: 'TOO_EARLY' });
    if (Date.now() - t > 4 * HOUR) return res.status(409).json({ error: 'This one has passed. Please tell your family.', code: 'TOO_LATE' });

    const updated = await Reminder.findOneAndUpdate(
      { _id: reminder._id, status: { $ne: 'taken' } },
      { status: 'taken', actedAt: new Date() },
      { new: true }
    );
    if (!updated) return res.json({ ok: true, already: true });

    await Activity.create({
      patient: pid,
      type: updated.kind === 'medication' ? 'medication_taken' : 'routine_done',
      message: updated.kind === 'medication' ? `Took ${updated.title}` : `Done: ${updated.title}`,
      source: 'patient',
    });
    await afterTaken(updated); // deducts pills and checks the supply
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Week 8: Buddy the virtual pet (daily mood + pain check-in) ───────────────
const PAIN_LABELS = ['No pain', 'A little pain', 'A lot of pain'];

router.get('/pet', requireFaceSession, async (req, res) => {
  try {
    const now = new Date();
    const tz = tzOf(req);
    const rows = await Activity.find({
      patient: req.devicePatient._id, type: 'pet_checkin', at: { $gte: new Date(now.getTime() - 40 * DAY) },
    }).select('at').lean();
    const days = new Set(rows.map((a) => localDateKey(new Date(a.at), tz)));

    const checkedInToday = days.has(localDateKey(now, tz));
    let streak = 0;
    let back = checkedInToday ? 0 : 1; // today not done yet doesn't break yesterday's streak
    while (days.has(localDateKey(new Date(now.getTime() - back * DAY), tz))) { streak++; back++; }
    res.json({ checkedInToday, streak });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/pet/checkin', requireFaceSession, async (req, res) => {
  try {
    const patient = req.devicePatient;
    const mood = Number(req.body?.mood);
    const pain = Number(req.body?.pain);
    if (!Number.isInteger(mood) || mood < 1 || mood > 5) return res.status(400).json({ error: 'Please pick how you feel' });
    if (!Number.isInteger(pain) || pain < 0 || pain > 2) return res.status(400).json({ error: 'Please pick if anything hurts' });

    await Activity.insertMany([
      { patient: patient._id, type: 'pet_checkin', message: 'Said hello to Buddy', source: 'patient' },
      { patient: patient._id, type: 'mood', value: mood, message: '', source: 'patient' },
      { patient: patient._id, type: 'pain', value: pain, message: PAIN_LABELS[pain], source: 'patient' },
    ]);

    const settings = await CaregiverSettings.findOne({ userId: patient.createdBy }).lean();
    const raise = async (type, severity, message, hours) => {
      const recent = await Alert.findOne({ patient: patient._id, type, raisedAt: { $gte: new Date(Date.now() - hours * HOUR) } });
      if (!recent) await Alert.create({ patient: patient._id, type, severity, message });
    };
    if (mood <= 2 && (settings?.notifyMoodDrops ?? true)) {
      await raise('low_mood', 'info', `${patient.name} says they feel ${MOOD_LABELS[mood].toLowerCase()} today`, 12);
    }
    if (pain === 2) await raise('high_pain', 'warning', `${patient.name} says they have a lot of pain`, 6);

    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Unpair ────────────────────────────────────────────────────────────────────
router.delete('/unpair', requireDevice, async (req, res) => {
  req.devicePatient.deviceTokenHash = undefined;
  req.devicePatient.pairedAt = undefined;
  await req.devicePatient.save();
  res.json({ ok: true });
});

export default router;