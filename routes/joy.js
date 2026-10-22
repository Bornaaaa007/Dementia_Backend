import express from 'express';
import Song from '../models/Song.js';
import GalleryPhoto from '../models/GalleryPhoto.js';
import { requireDevice } from '../middleware/requireDevice.js';

// Mounted at /api/patient-device/joy
const router = express.Router();

// Returns one random uplifting item (song or photo) for the Daily Joy Button.
// We do NOT limit to once per day server-side — the patient screen handles the
// "you already had your joy today" UX so it stays gentle, not punishing.
router.post('/reveal', requireDevice, async (req, res) => {
  try {
    const patientId = req.patient._id;

    // Pick from whichever pools have content
    const [songCount, photoCount] = await Promise.all([
      Song.countDocuments({ patient: patientId }),
      GalleryPhoto.countDocuments({ patient: patientId }),
    ]);

    const total = songCount + photoCount;

    if (total === 0) {
      return res.json({ item: null, reason: 'empty' });
    }

    // Weighted random: equal chance per item across both pools
    const pick = Math.floor(Math.random() * total);

    if (pick < songCount) {
      // Pick a random song
      const songs = await Song.find({ patient: patientId }).select('title artist note linkedMemory');
      const song = songs[Math.floor(Math.random() * songs.length)];
      return res.json({
        item: {
          kind: 'song',
          id: String(song._id),
          title: song.title,
          artist: song.artist || '',
          note: song.note || '',
          linkedMemory: song.linkedMemory ? String(song.linkedMemory) : null,
        },
      });
    } else {
      // Pick a random photo
      const photos = await GalleryPhoto.find({ patient: patientId }).select('photoUrl caption takenAt linkedMemory linkedSong');
      const photo = photos[Math.floor(Math.random() * photos.length)];
      return res.json({
        item: {
          kind: 'photo',
          id: String(photo._id),
          photoUrl: photo.photoUrl,
          caption: photo.caption || '',
          takenAt: photo.takenAt || '',
          linkedMemory: photo.linkedMemory ? String(photo.linkedMemory) : null,
          linkedSong:   photo.linkedSong   ? String(photo.linkedSong)   : null,
        },
      });
    }
  } catch (err) {
    res.status(500).json({ error: err.message || 'Something went wrong' });
  }
});

export default router;