import Activity from '../models/Activity.js';
import Alert from '../models/Alert.js';
import CaregiverSettings from '../models/CaregiverSettings.js';
import Patient from '../models/Patient.js';
import Reminder from '../models/Reminder.js';
import Schedule from '../models/Schedule.js';
import { GRACE_MS } from './dashboard.js';
import { generateReminders } from './schedule.js';

const HOUR = 3600000;
const DAY = 24 * HOUR;
const TICK_MS = 5 * 60 * 1000;

// Does the profile owner want missed-medication alerts? (default: yes)
async function wantsMissedAlerts(patientId) {
  const patient = await Patient.findById(patientId).select('createdBy');
  if (!patient) return false;
  const settings = await CaregiverSettings.findOne({ userId: patient.createdBy }).lean();
  return settings?.notifyMissedMeds ?? true;
}

// Missed-day rule: 2+ doses missed in 24 hours, or a missed dose on two days in a row
async function escalate(patientId, now) {
  const since24 = new Date(now.getTime() - DAY);
  const since48 = new Date(now.getTime() - 2 * DAY);
  const base = { patient: patientId, kind: 'medication', status: 'missed', demo: { $ne: true } };
  const [last24, previous24] = await Promise.all([
    Reminder.countDocuments({ ...base, scheduledAt: { $gte: since24, $lte: now } }),
    Reminder.countDocuments({ ...base, scheduledAt: { $gte: since48, $lt: since24 } }),
  ]);
  const severeToday = last24 >= 2;
  const twoDays = last24 >= 1 && previous24 >= 1;
  if (!severeToday && !twoDays) return;

  // one escalation per 24 hours, even if the family has already resolved the last one
  const recent = await Alert.findOne({ patient: patientId, type: 'missed_day', raisedAt: { $gte: since24 } });
  if (recent) return;

  await Alert.create({
    patient: patientId,
    type: 'missed_day',
    severity: 'critical',
    message: severeToday ? `${last24} doses were missed in the last 24 hours` : 'Medication was missed two days in a row',
  });
}

// Turns reminders that nobody acted on into "missed", logs it, and raises alerts
export async function markMissed(now = new Date()) {
  const due = await Reminder.find({
    status: 'pending',
    demo: { $ne: true },
    scheduledAt: { $lt: new Date(now.getTime() - GRACE_MS), $gte: new Date(now.getTime() - 3 * DAY) },
  }).sort({ scheduledAt: 1 });

  const missedByPatient = new Map(); // patient id -> titles of missed medicine doses
  for (const r of due) {
    const res = await Reminder.updateOne({ _id: r._id, status: 'pending' }, { status: 'missed' });
    if (!res.modifiedCount || r.kind !== 'medication') continue;

    const key = String(r.patient);
    if (!missedByPatient.has(key)) missedByPatient.set(key, []);
    missedByPatient.get(key).push(r.title);
    await Activity.create({ patient: r.patient, type: 'medication_missed', message: `Missed: ${r.title}`, source: 'system' });
  }

  for (const [patientId, titles] of missedByPatient) {
    if (!(await wantsMissedAlerts(patientId))) continue;
    await Alert.create({
      patient: patientId,
      type: 'missed_medication',
      severity: 'warning',
      message: `Missed: ${titles.join(', ')}`.slice(0, 300),
    });
    await escalate(patientId, now);
  }
}

export async function tick(now = new Date()) {
  const schedules = await Schedule.find({ active: true });
  for (const s of schedules) await generateReminders(s, now); // keeps today + tomorrow filled in
  await markMissed(now);
}

export function startScheduler() {
  const run = () => tick().catch((err) => console.warn('[scheduler]', err.message));
  console.log('[scheduler] started');
  run();
  return setInterval(run, TICK_MS);
}