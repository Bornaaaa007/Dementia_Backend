import express from 'express';
import PushToken from '../models/PushToken.js';

const router = express.Router();
const TOKEN_RE = /^(Exponent|Expo)PushToken\[[A-Za-z0-9_-]{10,}\]$/;

router.post('/register', async (req, res) => {
  try {
    const token = String(req.body?.token || '').trim();
    if (!TOKEN_RE.test(token)) return res.status(400).json({ error: 'That is not a valid push token' });
    const platform = ['ios', 'android', 'web'].includes(req.body?.platform) ? req.body.platform : 'unknown';
    // a token belongs to one phone; if someone else logs in on it, it moves to them
    await PushToken.findOneAndUpdate({ token }, { $set: { userId: req.user.id, platform } }, { upsert: true, new: true });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/unregister', async (req, res) => {
  try {
    const token = String(req.body?.token || '').trim();
    if (token) await PushToken.deleteOne({ token, userId: req.user.id });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

export default router;