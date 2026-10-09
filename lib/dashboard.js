// Pure functions: no database access, so they are easy to test.
const DAY = 86400000;
const HOUR = 3600000;
const GRACE_MS = HOUR; // a reminder is "due" for 1 hour, then counts as missed

export const MOOD_LABELS = { 1: 'Very low', 2: 'Low', 3: 'Okay', 4: 'Good', 5: 'Great' };

// tzOffsetMinutes = new Date().getTimezoneOffset() from the phone/browser (Dhaka = -360)
export function localDayStart(date, tzOffsetMinutes = 0) {
  const off = tzOffsetMinutes * 60000;
  return new Date(Math.floor((date.getTime() - off) / DAY) * DAY + off);
}

export function localDateKey(date, tzOffsetMinutes = 0) {
  return new Date(date.getTime() - tzOffsetMinutes * 60000).toISOString().slice(0, 10);
}

export function effectiveStatus(reminder, now) {
  if (reminder.status !== 'pending') return reminder.status; // taken | missed
  const t = new Date(reminder.scheduledAt).getTime();
  if (t > now.getTime()) return 'upcoming';
  if (now.getTime() - t <= GRACE_MS) return 'due';
  return 'missed';
}

const avg = (nums) => (nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null);
const round1 = (n) => (n === null ? null : Math.round(n * 10) / 10);

function lastSevenDayKeys(now, tz) {
  const today = localDayStart(now, tz).getTime();
  return Array.from({ length: 7 }, (_, i) => localDateKey(new Date(today - (6 - i) * DAY + 12 * HOUR), tz));
}

export function buildDashboard({ patient, activities = [], reminders = [], alerts = [], settings = {}, now = new Date(), tzOffsetMinutes = 0 }) {
  const staleAfterHours = settings.staleAfterHours ?? 24;
  const tz = tzOffsetMinutes;
  const dayKeys = lastSevenDayKeys(now, tz);
  const todayStart = localDayStart(now, tz).getTime();

  const hasData = activities.length + reminders.length + alerts.length > 0;

  // ---- freshness: only signals coming from the patient's own device count
  const patientSignals = activities.filter((a) => a.source === 'patient');
  const lastPatientActivityAt = patientSignals.length
    ? new Date(Math.max(...patientSignals.map((a) => new Date(a.at).getTime())))
    : null;
  const hoursSince = lastPatientActivityAt ? (now.getTime() - lastPatientActivityAt.getTime()) / HOUR : null;
  const stale = hasData && (hoursSince === null || hoursSince > staleAfterHours);

  // ---- recent activity
  const recentActivity = [...activities]
    .sort((a, b) => new Date(b.at) - new Date(a.at))
    .slice(0, 10)
    .map((a) => ({ id: String(a._id), type: a.type, message: a.message || '', value: a.value ?? null, at: a.at, source: a.source }));

  // ---- today's reminders
  const todays = reminders
    .filter((r) => {
      const t = new Date(r.scheduledAt).getTime();
      return t >= todayStart && t < todayStart + DAY;
    })
    .sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt))
    .map((r) => ({
      id: String(r._id), title: r.title, kind: r.kind, scheduledAt: r.scheduledAt,
      status: effectiveStatus(r, now), actedAt: r.actedAt || null,
    }));
  const nextReminder = todays.find((r) => r.status === 'due' || r.status === 'upcoming') || null;

  // ---- 7-day medication adherence
  const perDay = Object.fromEntries(dayKeys.map((k) => [k, { date: k, taken: 0, missed: 0 }]));
  let taken = 0;
  let missed = 0;
  for (const r of reminders) {
    if (r.kind !== 'medication') continue;
    const key = localDateKey(new Date(r.scheduledAt), tz);
    if (!perDay[key]) continue;
    const s = effectiveStatus(r, now);
    if (s === 'taken') { taken++; perDay[key].taken++; }
    if (s === 'missed') { missed++; perDay[key].missed++; }
  }
  const total = taken + missed;
  const percent = total ? Math.round((taken / total) * 100) : null;
  const level = percent === null ? 'none' : percent >= 85 ? 'good' : percent >= 60 ? 'fair' : 'poor';

  // ---- 7-day mood summary
  const moods = activities.filter((a) => a.type === 'mood' && a.value >= 1 && a.value <= 5);
  const moodByDay = Object.fromEntries(dayKeys.map((k) => [k, []]));
  for (const m of moods) {
    const key = localDateKey(new Date(m.at), tz);
    if (moodByDay[key]) moodByDay[key].push(m.value);
  }
  const days = dayKeys.map((k) => ({ date: k, value: round1(avg(moodByDay[k])) }));
  const weekValues = dayKeys.flatMap((k) => moodByDay[k]);
  const latestMood = [...moods].sort((a, b) => new Date(b.at) - new Date(a.at))[0] || null;
  const recentAvg = avg(days.slice(4).map((d) => d.value).filter((v) => v !== null));
  const earlierAvg = avg(days.slice(0, 4).map((d) => d.value).filter((v) => v !== null));
  let trend = 'unknown';
  if (recentAvg !== null && earlierAvg !== null) {
    const diff = recentAvg - earlierAvg;
    trend = diff >= 0.5 ? 'up' : diff <= -0.5 ? 'down' : 'steady';
  }

  // ---- alerts
  const order = { critical: 0, warning: 1, info: 2 };
  const unresolved = alerts
    .filter((a) => !a.resolvedAt)
    .sort((a, b) => order[a.severity] - order[b.severity] || new Date(b.raisedAt) - new Date(a.raisedAt))
    .map((a) => ({ id: String(a._id), type: a.type, severity: a.severity, message: a.message, raisedAt: a.raisedAt }));
  const critical = unresolved.filter((a) => a.severity === 'critical').length;

  // ---- overall state
  let dataState = 'ok';
  if (!hasData) dataState = 'empty';
  else if (stale) dataState = 'stale';

  let status = 'good';
  let headline = `${patient.name} is doing well`;
  if (dataState === 'empty') { status = 'empty'; headline = `No data yet for ${patient.name}`; }
  else if (critical > 0) { status = 'critical'; headline = 'Urgent alert needs attention'; }
  else if (unresolved.length > 0) { status = 'attention'; headline = `${unresolved.length} alert${unresolved.length > 1 ? 's' : ''} need attention`; }
  else if (dataState === 'stale') { status = 'stale'; headline = 'Information may be out of date'; }

  return {
    generatedAt: now,
    dataState, staleAfterHours, lastPatientActivityAt,
    overview: { status, headline, unresolvedAlerts: unresolved.length, criticalAlerts: critical },
    recentActivity,
    reminders: { today: todays, next: nextReminder },
    adherence: { windowDays: 7, taken, missed, percent, level, perDay: dayKeys.map((k) => perDay[k]) },
    mood: {
      latest: latestMood ? { value: latestMood.value, label: MOOD_LABELS[latestMood.value], at: latestMood.at, note: latestMood.message || '' } : null,
      average: round1(avg(weekValues)), count: weekValues.length, trend, days,
    },
    alerts: { unresolved },
  };
}
