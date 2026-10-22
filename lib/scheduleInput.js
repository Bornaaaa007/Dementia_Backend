// Validation for medicines and routines. Pure functions, so they can be tested without a database.
export const LIMITS = { title: 120, dose: 60, times: 8, pills: 1000 };
const TIME = /^([01]?\d|2[0-3]):([0-5]\d)$/;

function normaliseTime(value) {
  const m = TIME.exec(String(value).trim());
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : null;
}

export function readSchedule(body = {}, partial = false) {
  const out = {};

  if (body.title !== undefined || !partial) {
    const title = String(body.title ?? '').trim();
    if (!title) throw new Error('Give it a name, for example "Morning tablet"');
    out.title = title.slice(0, LIMITS.title);
  }
  if (body.kind !== undefined || !partial) out.kind = body.kind === 'routine' ? 'routine' : 'medication';
  if (body.dose !== undefined) out.dose = String(body.dose || '').trim().slice(0, LIMITS.dose);

  if (body.times !== undefined || !partial) {
    const raw = Array.isArray(body.times) ? body.times : String(body.times ?? '').split(/[,\s]+/);
    const times = [...new Set(raw.filter((x) => String(x).trim()).map(normaliseTime))];
    if (times.some((t) => t === null)) throw new Error('Times must look like 08:30 (24-hour), separated by commas');
    if (!times.length) throw new Error('Add at least one time, for example 08:00');
    if (times.length > LIMITS.times) throw new Error(`Use ${LIMITS.times} times or fewer`);
    out.times = times.sort();
  }

  if (body.tzOffsetMinutes !== undefined) {
    const tz = Number(body.tzOffsetMinutes);
    if (Number.isFinite(tz) && Math.abs(tz) <= 840) out.tzOffsetMinutes = tz;
  }
  if (body.active !== undefined) out.active = !!body.active;

  if (body.pillsRemaining !== undefined) {
    if (body.pillsRemaining === null || body.pillsRemaining === '') out.pillsRemaining = null;
    else {
      const n = Number(body.pillsRemaining);
      if (!Number.isInteger(n) || n < 0 || n > LIMITS.pills) throw new Error('Pill count must be a whole number');
      out.pillsRemaining = n;
    }
  }
  if (body.pillsPerDose !== undefined) {
    const n = Number(body.pillsPerDose);
    if (!Number.isInteger(n) || n < 1 || n > 10) throw new Error('Pills per dose must be a whole number from 1 to 10');
    out.pillsPerDose = n;
  }
  return out;
}