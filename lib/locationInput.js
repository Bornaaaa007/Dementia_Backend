// Validation for the location feature. Pure functions, so they can be tested without a database.
import { DEFAULT_RADIUS_M, MAX_RADIUS_M, MIN_RADIUS_M } from './geofence.js';

const validLat = (n) => Number.isFinite(n) && Math.abs(n) <= 90;
const validLng = (n) => Number.isFinite(n) && Math.abs(n) <= 180;

// What the patient's device sends: { lat, lng, accuracy?, at? }
export function readPing(body = {}) {
  const lat = Number(body.lat);
  const lng = Number(body.lng);
  if (!validLat(lat) || !validLng(lng)) throw new Error('The location is not valid');
  const out = { lat, lng };
  const accuracy = Number(body.accuracy);
  if (body.accuracy !== undefined && body.accuracy !== null && Number.isFinite(accuracy) && accuracy >= 0) out.accuracy = accuracy;
  if (body.at !== undefined) {
    const at = new Date(body.at);
    if (!Number.isNaN(at.getTime())) out.at = at;
  }
  return out;
}

// What the profile owner can change: { trackingEnabled?, safeZone? }
export function readLocationSettings(body = {}) {
  const out = {};
  if (body.trackingEnabled !== undefined) out.trackingEnabled = body.trackingEnabled === true;
  if (body.safeZone !== undefined) {
    const z = body.safeZone || {};
    const lat = Number(z.lat);
    const lng = Number(z.lng);
    if (!validLat(lat) || !validLng(lng)) throw new Error('The safe area needs a valid location');
    const radiusM = z.radiusM === undefined ? DEFAULT_RADIUS_M : Number(z.radiusM);
    if (!Number.isFinite(radiusM) || radiusM < MIN_RADIUS_M || radiusM > MAX_RADIUS_M) {
      throw new Error(`The safe area radius must be between ${MIN_RADIUS_M} and ${MAX_RADIUS_M} metres`);
    }
    const label = String(z.label ?? 'Home').trim() || 'Home';
    if (label.length > 40) throw new Error('The place name must be 40 characters or fewer');
    out.safeZone = { label, lat, lng, radiusM: Math.round(radiusM) };
  }
  return out;
}

// Optional note when a caregiver says "they are with me"
export function readSafeNote(body = {}) {
  const note = String(body.note ?? '').trim();
  if (note.length > 200) throw new Error('The note must be 200 characters or fewer');
  return note;
}
