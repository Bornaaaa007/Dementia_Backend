// Pure helper (no database), used by the dashboard and the schedule routes.
export const LOW_SUPPLY_DAYS = 5;

export function supplyInfo(schedule) {
  if (!schedule || schedule.kind !== 'medication') return null;
  const left = schedule.pillsRemaining;
  if (left === null || left === undefined) return null; // not counting pills for this medicine
  const perDay = Math.max(1, (schedule.times || []).length) * (schedule.pillsPerDose || 1);
  const daysLeft = Math.floor(left / perDay);
  const level = left === 0 ? 'out' : daysLeft <= LOW_SUPPLY_DAYS ? 'low' : 'ok';
  return { pillsRemaining: left, perDay, daysLeft, level };
}