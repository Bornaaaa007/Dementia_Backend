import Alert from '../models/Alert.js';
import Reminder from '../models/Reminder.js';
import Schedule from '../models/Schedule.js';
import { localDateKey, localDayStart } from './dashboard.js';
import { supplyInfo } from './supply.js';

const HOUR = 3600000;
const DAY = 24 * HOUR;

// Creates today's and tomorrow's reminders for one schedule. Safe to call again and again:
// every slot has a unique key, and times that have already passed are never created.
export async function generateReminders(schedule, now = new Date()) {
  if (!schedule.active) return 0;
  const tz = schedule.tzOffsetMinutes || 0;
  const start = localDayStart(now, tz).getTime();
  const ops = [];

  for (const d of [0, 1]) {
    const dayStart = start + d * DAY;
    const dayKey = localDateKey(new Date(dayStart + 12 * HOUR), tz);
    for (const time of schedule.times) {
      const [hh, mm] = time.split(':').map(Number);
      const scheduledAt = new Date(dayStart + (hh * 60 + mm) * 60000);
      if (scheduledAt.getTime() <= now.getTime()) continue;
      ops.push({
        updateOne: {
          filter: { slotKey: `${schedule._id}:${dayKey}:${time}` },
          update: {
            $setOnInsert: {
              patient: schedule.patient, schedule: schedule._id, title: schedule.title,
              kind: schedule.kind, scheduledAt, status: 'pending', createdBy: 'schedule',
            },
          },
          upsert: true,
        },
      });
    }
  }
  if (!ops.length) return 0;
  const res = await Reminder.bulkWrite(ops, { ordered: false });
  return res.upsertedCount || 0;
}

// Raises, updates or resolves the "running low" alert for one medicine
export async function checkSupply(schedule) {
  const ref = `supply:${schedule._id}`;
  const info = schedule.active ? supplyInfo(schedule) : null;

  if (!info || info.level === 'ok') {
    await Alert.updateMany({ ref, resolvedAt: null }, { resolvedAt: new Date(), resolvedBy: 'system' });
    return;
  }

  const left = info.daysLeft < 1 ? 'less than a day' : `about ${info.daysLeft} day${info.daysLeft === 1 ? '' : 's'}`;
  const message =
    info.level === 'out'
      ? `${schedule.title} has run out. Please buy more.`
      : `${schedule.title}: only ${info.pillsRemaining} left (${left}). Time to buy more.`;
  const severity = info.level === 'out' ? 'critical' : 'warning';

  const open = await Alert.findOne({ ref, resolvedAt: null });
  if (open) {
    if (open.message !== message || open.severity !== severity) {
      open.message = message;
      open.severity = severity;
      await open.save();
    }
    return;
  }
  // The family resolved it recently: don't raise it again after every single dose
  const recent = await Alert.findOne({ ref, severity, raisedAt: { $gte: new Date(Date.now() - DAY) } });
  if (recent) return;

  await Alert.create({ patient: schedule.patient, type: 'low_supply', severity, message, ref });
}

// Call after a reminder has been set to "taken": deducts the pills once, then checks the supply.
export async function afterTaken(reminder) {
  if (!reminder.schedule) return;
  const claimed = await Reminder.findOneAndUpdate({ _id: reminder._id, consumed: { $ne: true } }, { consumed: true });
  if (!claimed) return; // already counted

  const schedule = await Schedule.findById(reminder.schedule);
  if (!schedule || schedule.kind !== 'medication') return;
  if (schedule.pillsRemaining === null || schedule.pillsRemaining === undefined) return;

  schedule.pillsRemaining = Math.max(0, schedule.pillsRemaining - (schedule.pillsPerDose || 1));
  await schedule.save();
  await checkSupply(schedule);
}