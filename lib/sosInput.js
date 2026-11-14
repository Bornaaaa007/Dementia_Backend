// Validation for the safety features. Pure functions, so they can be tested without a database.
export const SOS_TYPES = ['help', 'emergency'];
export const LOCATION_STATUSES = ['off', 'shared', 'denied', 'unavailable'];
export const MAX_CONTACTS = 5;

const PHONE_RE = /^\+?[0-9][0-9 ()-]{3,23}$/;
const digitCount = (text) => (text.match(/[0-9]/g) || []).length;

export function readContact(body = {}, { partial = false } = {}) {
  const out = {};
  const has = (key) => body[key] !== undefined;

  if (!partial || has('name')) {
    const name = String(body.name ?? '').trim();
    if (!name) throw new Error("Please enter the contact's name");
    if (name.length > 60) throw new Error('Name must be 60 characters or fewer');
    out.name = name;
  }
  if (!partial || has('phone')) {
    const phone = String(body.phone ?? '').trim();
    if (!phone) throw new Error('Please enter a phone number');
    if (!PHONE_RE.test(phone) || digitCount(phone) < 5) throw new Error('Enter a valid phone number, for example 01712 345678 or +8801712345678');
    out.phone = phone;
  }
  if (has('relationship')) {
    const relationship = String(body.relationship ?? '').trim();
    if (relationship.length > 40) throw new Error('Relationship must be 40 characters or fewer');
    out.relationship = relationship;
  }
  return out;
}

export function readSettings(body = {}) {
  const out = {};
  if (body.shareLocationOnSos !== undefined) out.shareLocationOnSos = body.shareLocationOnSos === true;
  if (body.emergencyNumber !== undefined) {
    const number = String(body.emergencyNumber).replace(/\s/g, '');
    if (!/^\+?[0-9]{3,15}$/.test(number)) throw new Error('Enter a valid emergency number, for example 999');
    out.emergencyNumber = number;
  }
  return out;
}

// What the patient's device sends when SOS is pressed
export function readSos(body = {}) {
  const type = body.type === undefined ? 'help' : body.type;
  if (!SOS_TYPES.includes(type)) throw new Error('type must be help or emergency');

  const locationStatus = body.locationStatus === undefined ? 'off' : body.locationStatus;
  if (!LOCATION_STATUSES.includes(locationStatus)) throw new Error('Invalid location status');

  const out = { type, locationStatus };
  if (locationStatus === 'shared') {
    const lat = Number(body.location?.lat);
    const lng = Number(body.location?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      throw new Error('The location is not valid');
    }
    const accuracy = Number(body.location?.accuracy);
    out.location = { lat, lng, ...(Number.isFinite(accuracy) && accuracy >= 0 ? { accuracy } : {}) };
  }
  return out;
}