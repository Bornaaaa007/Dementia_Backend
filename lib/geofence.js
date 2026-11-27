// Pure functions (no database), so they can be tested on their own.

export const DEFAULT_RADIUS_M = 150;
export const MIN_RADIUS_M = 50;
export const MAX_RADIUS_M = 5000;

export const CONFIRM_PINGS = 2;        // this many confident "outside" readings in a row before anyone is alerted
export const RETURN_PINGS = 2;         // this many "inside" readings in a row before the episode counts as over
export const MAX_ACCURACY_M = 150;     // a reading less precise than this is shown on the map but never changes anything
export const STALE_AFTER_MS = 15 * 60 * 1000; // no report for this long = "last known position"
// If a caregiver said "they're with me" and the patient is STILL away after this long, the family is alerted again
export const SAFE_WINDOW_MS = Number(process.env.SAFE_WINDOW_HOURS || 4) * 3600000;

const EARTH_M = 6371000;
const rad = (deg) => (deg * Math.PI) / 180;

// Great-circle distance in metres between {lat, lng} and {lat, lng}
export function distanceMeters(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Where is this reading compared with the safe area?  'inside' | 'outside' | 'unknown'
// 'outside' is only claimed when the whole accuracy circle of the reading is beyond the border.
export function classifyPing(zone, ping) {
  const distanceM = Math.round(distanceMeters(zone, ping));
  const accuracy = Number.isFinite(ping.accuracy) && ping.accuracy > 0 ? ping.accuracy : 0;
  if (accuracy > MAX_ACCURACY_M) return { distanceM, where: 'unknown' };
  if (distanceM <= zone.radiusM) return { distanceM, where: 'inside' };
  if (distanceM - accuracy > zone.radiusM) return { distanceM, where: 'outside' };
  return { distanceM, where: 'unknown' };
}

// What should happen after this reading?
//   open    = the patient's open episode, or null  ({ status, safeAt })
//   returns the new streak counters and one action: 'none' | 'open' | 'reopen' | 'return'
export function decide({ where, outsideStreak = 0, insideStreak = 0, open = null, now = Date.now() }) {
  if (where === 'inside') {
    const inside = insideStreak + 1;
    return { outsideStreak: 0, insideStreak: inside, action: open && inside >= RETURN_PINGS ? 'return' : 'none' };
  }
  if (where === 'outside') {
    const outside = outsideStreak + 1;
    let action = 'none';
    if (!open) {
      if (outside >= CONFIRM_PINGS) action = 'open';
    } else if (open.status === 'safe' && open.safeAt && now - new Date(open.safeAt).getTime() >= SAFE_WINDOW_MS) {
      action = 'reopen';
    }
    return { outsideStreak: outside, insideStreak: 0, action };
  }
  return { outsideStreak, insideStreak, action: 'none' }; // unknown: change nothing
}

export function formatDistance(m) {
  if (!Number.isFinite(m)) return '';
  return m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`;
}
