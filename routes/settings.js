import express from 'express';
import CaregiverSettings from '../models/CaregiverSettings.js';

const router = express.Router();

const publicSettings = (s) => ({
  staleAfterHours: s.staleAfterHours, notifyMissedMeds: s.notifyMissedMeds,
  notifyMoodDrops: s.notifyMoodDrops, notifyInactivity: s.notifyInactivity, lastPatientId: s.lastPatientId || null,
});

router.get('/', async (req, res) => {
  const settings = await CaregiverSettings.findOneAndUpdate(
    { userId: req.user.id }, { $setOnInsert: { userId: req.user.id } }, { new: true, upsert: true }
  );
  res.json({ settings: publicSettings(settings), user: { id: req.user.id, name: req.user.name, email: req.user.email } });
});

router.put('/', async (req, res) => {
  try {
    const update = {};
    const b = req.body || {};
    if (b.staleAfterHours !== undefined) {
      const h = Number(b.staleAfterHours);
      if (!Number.isFinite(h) || h < 1 || h > 168) return res.status(400).json({ error: 'Stale threshold must be 1 to 168 hours' });
      update.staleAfterHours = h;
    }
    for (const key of ['notifyMissedMeds', 'notifyMoodDrops', 'notifyInactivity']) {
      if (b[key] !== undefined) update[key] = !!b[key];
    }
    if (b.lastPatientId !== undefined) update.lastPatientId = String(b.lastPatientId || '');
    const settings = await CaregiverSettings.findOneAndUpdate(
      { userId: req.user.id }, { $set: update, $setOnInsert: { userId: req.user.id } }, { new: true, upsert: true }
    );
    res.json({ settings: publicSettings(settings) });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

export default router;
