import crypto from 'crypto';

const TTL_MS = Number(process.env.PATIENT_SESSION_HOURS || 12) * 60 * 60 * 1000;

const sign = (payload) =>
  crypto.createHmac('sha256', process.env.BETTER_AUTH_SECRET).update(`patient-session:${payload}`).digest('base64url');

// Short-lived token issued only after a successful face check. Stateless: nothing is stored.
export function signSession(patientId) {
  const expiresAt = Date.now() + TTL_MS;
  const payload = Buffer.from(JSON.stringify({ pid: String(patientId), exp: expiresAt })).toString('base64url');
  return { token: `${payload}.${sign(payload)}`, expiresAt };
}

export function verifySession(token, patientId) {
  const [payload, sig] = String(token || '').split('.');
  if (!payload || !sig) return false;
  const a = Buffer.from(sig);
  const b = Buffer.from(sign(payload));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  try {
    const { pid, exp } = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return pid === String(patientId) && exp > Date.now();
  } catch {
    return false;
  }
}