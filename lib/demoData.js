import { localDayStart } from './dashboard.js';

const DAY = 86400000;
const HOUR = 3600000;

// scenario: 'normal' | 'stale' | 'empty'
// Returns plain objects (no patient id) so it can be tested without a database.
export function buildDemoData({ scenario = 'normal', now = new Date(), tzOffsetMinutes = 0, userId = 'demo' }) {
  if (scenario === 'empty') return { activities: [], reminders: [], alerts: [] };

  const stale = scenario === 'stale';
  const ago = (hours) => new Date(now.getTime() - hours * HOUR);
  const todayStart = localDayStart(now, tzOffsetMinutes).getTime();
  const at = (daysAgo, hh, mm = 0) => new Date(todayStart - daysAgo * DAY + (hh * 60 + mm) * 60000);
  const shift = stale ? 52 : 0; // stale: nothing from the patient for more than 2 days

  // ---- activities (from the patient's device)
  const patientEvents = [
    [0.4, 'app_open', 'Opened the app'],
    [2.5, 'meal', 'Had breakfast'],
    [5, 'walk', 'Went for a short walk'],
    [9, 'call', 'Phone call with family'],
    [26, 'app_open', 'Opened the app'],
    [30, 'meal', 'Had dinner'],
    [50, 'walk', 'Evening walk in the garden'],
    [74, 'app_open', 'Opened the app'],
  ];
  const activities = patientEvents.map(([h, type, message]) => ({
    type, message, at: ago(h + shift), source: 'patient', demo: true, createdBy: 'demo',
  }));

  // moods: oldest -> newest (6 days ago ... today)
  const moodValues = [3, 4, 4, 3, 2, 3, 4];
  const moodNotes = { 2: 'Seemed tired and quiet', 4: 'Cheerful, talked about the garden' };
  moodValues.forEach((value, i) => {
    const daysAgo = 6 - i;
    if (stale && daysAgo < 3) return; // no recent moods when stale
    const when = daysAgo === 0 ? ago(1) : at(daysAgo, 20);
    activities.push({ type: 'mood', value, message: moodNotes[value] || '', at: when, source: 'patient', demo: true, createdBy: 'demo' });
  });
  activities.push({ type: 'note', message: 'Doctor visit went well, next check-up in 3 weeks', at: ago(30 + (stale ? 40 : 0)), source: 'caregiver', demo: true, createdBy: userId });

  // ---- reminders: 3 medications a day for the last 6 days (T = taken, M = missed)
  const pattern = {
    6: 'TTT', 5: 'TTM', 4: 'TTT', 3: 'TMT', 2: 'TTT', 1: 'TTM',
  };
  const slots = [[8, 0, 'Morning medication'], [13, 0, 'Lunch medication'], [20, 0, 'Evening medication']];
  const reminders = [];
  for (const [d, marks] of Object.entries(pattern)) {
    slots.forEach(([hh, mm, title], i) => {
      const scheduledAt = at(Number(d), hh, mm);
      const takenFlag = marks[i] === 'T';
      reminders.push({
        title, kind: 'medication', scheduledAt, demo: true, createdBy: 'demo',
        status: takenFlag ? 'taken' : 'missed',
        actedAt: takenFlag ? new Date(scheduledAt.getTime() + 10 * 60000) : undefined,
      });
    });
  }
  // today: past ones taken (normal) / left pending (stale), future ones pending
  slots.forEach(([hh, mm, title]) => {
    const scheduledAt = at(0, hh, mm);
    const past = scheduledAt.getTime() < now.getTime() - HOUR;
    const status = past && !stale ? 'taken' : 'pending';
    reminders.push({
      title, kind: 'medication', scheduledAt, demo: true, createdBy: 'demo', status,
      actedAt: status === 'taken' ? new Date(scheduledAt.getTime() + 8 * 60000) : undefined,
    });
  });
  reminders.push({ title: 'Afternoon walk', kind: 'routine', scheduledAt: at(0, 16, 30), status: 'pending', demo: true, createdBy: 'demo' });

  // ---- alerts
  const alerts = [
    { type: 'missed_medication', severity: 'warning', message: 'Evening medication was missed yesterday', raisedAt: ago(16), demo: true },
    { type: 'low_mood', severity: 'info', message: 'Mood was low (2/5) three days ago', raisedAt: ago(70), demo: true },
    { type: 'sos', severity: 'critical', message: 'SOS button pressed (test)', raisedAt: ago(120), resolvedAt: ago(119), resolvedBy: userId, demo: true },
  ];
  if (stale) {
    alerts.unshift({ type: 'inactivity', severity: 'warning', message: 'No activity from the patient for over 2 days', raisedAt: ago(2), demo: true });
  }
  return { activities, reminders, alerts };
}
