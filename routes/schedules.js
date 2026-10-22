import express from 'express';
import mongoose from 'mongoose';
import Alert from '../models/Alert.js';
import Reminder from '../models/Reminder.js';
import Schedule from '../models/Schedule.js';
import { checkSupply, generateReminders } from '../lib/schedule.js';
import { readSchedule } from '../lib/scheduleInput.js';
import { supplyInfo } from '../lib/supply.js';

// Mounted at /api/patients/:id/schedules (login + patient access are checked in server.js)
const router = express.Router();

const fail = (res, err, code = 400) => res.status(code).json({ error: err.message || String(err) });

const serialize = (s) => ({
  id: String(s._id), kind: s.kind, title: s.title, dose: s.dose || '', times: s.times, active: s.active,
  pillsRemaining: s.pillsRemaining ?? null, pillsPerDose: s.pillsPerDose || 1, supply: supplyInfo(s),
});

// Removes reminders that haven't happened yet, so they can be created again from the new plan
const clearFuture = (schedule) =>
  Reminder.deleteMany({ schedule: schedule._id, status: 'pending', scheduledAt: { $gt: new Date() } });

async function findOwn(req, res) {
  if (!mongoose.isValidObjectId(req.params.sid)) {
    res.status(400).json({ error: 'Invalid id' });
    return null;
  }
  const schedule = await Schedule.findOne({ _id: req.params.sid, patient: req.patient._id });
  if (!schedule) res.status(404).json({ error: 'Not found' });
  return schedule;
}

router.get('/', async (req, res) => {
  try {
    const items = await Schedule.find({ patient: req.patient._id }).sort({ kind: 1, title: 1 });
    res.json({ schedules: items.map(serialize) });
  } catch (err) { fail(res, err, 500); }
});

router.post('/', async (req, res) => {
  try {
    const data = readSchedule(req.body);
    if (data.kind === 'routine') { data.pillsRemaining = null; data.dose = ''; }
    const schedule = await Schedule.create({ ...data, patient: req.patient._id, createdBy: req.user.id });
    await generateReminders(schedule);
    await checkSupply(schedule);
    res.status(201).json({ schedule: serialize(schedule) });
  } catch (err) { fail(res, err); }
});

router.put('/:sid', async (req, res) => {
  try {
    const schedule = await findOwn(req, res);
    if (!schedule) return;
    Object.assign(schedule, readSchedule(req.body, true));
    if (schedule.kind === 'routine') schedule.pillsRemaining = null;
    await schedule.save();
    await clearFuture(schedule);
    await generateReminders(schedule);
    await checkSupply(schedule);
    res.json({ schedule: serialize(schedule) });
  } catch (err) { fail(res, err); }
});

// "I bought 30 more": adds pills and clears the low-supply alert if it is no longer low
router.post('/:sid/refill', async (req, res) => {
  try {
    const schedule = await findOwn(req, res);
    if (!schedule) return;
    if (schedule.kind !== 'medication') return res.status(400).json({ error: 'Only medicines have pills' });
    const add = Number(req.body?.add);
    if (!Number.isInteger(add) || add < 1 || add > 1000) return res.status(400).json({ error: 'Enter how many pills you added' });
    schedule.pillsRemaining = (schedule.pillsRemaining ?? 0) + add;
    schedule.lastRefillAt = new Date();
    await schedule.save();
    await checkSupply(schedule);
    res.json({ schedule: serialize(schedule) });
  } catch (err) { fail(res, err); }
});

router.delete('/:sid', async (req, res) => {
  try {
    const schedule = await findOwn(req, res);
    if (!schedule) return;
    await clearFuture(schedule);
    await Alert.updateMany({ ref: `supply:${schedule._id}`, resolvedAt: null }, { resolvedAt: new Date(), resolvedBy: 'system' });
    await schedule.deleteOne();
    res.json({ message: 'Deleted' });
  } catch (err) { fail(res, err, 500); }
});

export default router;