import Alert from '../models/Alert.js';

// If a family member resolved the dashboard alert, the SOS counts as handled even if its own status was not updated.
export async function withEffectiveStatus(events) {
  const ids = events.map((e) => e.alertId).filter(Boolean);
  const alerts = ids.length ? await Alert.find({ _id: { $in: ids } }).select('resolvedAt').lean() : [];
  const resolved = new Set(alerts.filter((a) => a.resolvedAt).map((a) => String(a._id)));
  return events.map((e) => {
    const plain = typeof e.toObject === 'function' ? e.toObject() : e;
    const status = ['active', 'acknowledged'].includes(plain.status) && plain.alertId && resolved.has(String(plain.alertId)) ? 'resolved' : plain.status;
    return { ...plain, status };
  });
}

export function serializeEvent(e) {
  return {
    id: String(e._id),
    type: e.type,
    status: e.status,
    locationStatus: e.locationStatus,
    location: e.location?.lat !== undefined && e.location?.lng !== undefined ? { lat: e.location.lat, lng: e.location.lng, accuracy: e.location.accuracy ?? null } : null,
    createdAt: e.createdAt,
    acknowledgedBy: e.acknowledgedBy || null,
    acknowledgedAt: e.acknowledgedAt || null,
    cancelledAt: e.cancelledAt || null,
    resolvedAt: e.resolvedAt || null,
    notifiedCount: e.notifiedCount || 0,
  };
}