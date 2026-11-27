import CaregiverSettings from '../models/CaregiverSettings.js';
import PushToken from '../models/PushToken.js';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

// Sends a push notification to every family account of a patient (owner + joined members).
//   exceptUserId  skip this account (the person who triggered it)
//   preference    a CaregiverSettings flag; people who switched it off are skipped
// Never throws: a push problem must never break the request that triggered it.
export async function notifyFamily(patient, { title, body, data = {} }, { exceptUserId, preference } = {}) {
  if (process.env.PUSH_DISABLED === 'true') return;
  try {
    let userIds = [patient.createdBy, ...(patient.members || [])].filter((id) => id && id !== exceptUserId);
    if (preference && userIds.length) {
      const optedOut = await CaregiverSettings.find({ userId: { $in: userIds }, [preference]: false }).select('userId').lean();
      const skip = new Set(optedOut.map((s) => s.userId));
      userIds = userIds.filter((id) => !skip.has(id));
    }
    if (!userIds.length) return;

    const tokens = await PushToken.find({ userId: { $in: userIds } }).lean();
    if (!tokens.length) return;

    const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
    if (process.env.EXPO_ACCESS_TOKEN) headers.Authorization = `Bearer ${process.env.EXPO_ACCESS_TOKEN}`;

    for (let i = 0; i < tokens.length; i += 100) {
      const chunk = tokens.slice(i, i + 100);
      const messages = chunk.map((t) => ({
        to: t.token, title, body, data: { ...data, patientId: String(patient._id) },
        sound: 'default', priority: 'high', channelId: 'default',
      }));
      const res = await fetch(EXPO_PUSH_URL, { method: 'POST', headers, body: JSON.stringify(messages) });
      const json = await res.json().catch(() => null);
      const tickets = Array.isArray(json?.data) ? json.data : [];
      const dead = chunk.filter((_, idx) => tickets[idx]?.status === 'error' && tickets[idx]?.details?.error === 'DeviceNotRegistered').map((t) => t.token);
      if (dead.length) await PushToken.deleteMany({ token: { $in: dead } });
    }
  } catch (err) {
    console.warn('[push]', err.message);
  }
}