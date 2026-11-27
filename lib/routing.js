// Walking directions from the patient's position back to the safe area.
// Works with any OSRM-style service. By default it uses the free community OpenStreetMap "foot" server;
// set MAPBOX_TOKEN to use Mapbox walking directions instead, or ROUTING_URL to point at your own OSRM server.

// The profile name in the URL ("driving") is only a label: this server instance only serves walking routes.
const DEFAULT_URL = 'https://routing.openstreetmap.de/routed-foot/route/v1/driving';

const TURNS = {
  left: 'left', right: 'right',
  'slight left': 'slight-left', 'slight right': 'slight-right',
  'sharp left': 'sharp-left', 'sharp right': 'sharp-right',
  uturn: 'uturn', straight: 'straight',
};

// Keeps only the instructions a walker needs: depart, real turns, roundabouts, arrive.
// "Continue straight" / "road changes name" steps are merged into the walk before them.
export function parseRoute(json) {
  const route = json?.routes?.[0];
  if (!route) throw new Error('No walking route was found');

  const steps = [];
  for (const leg of route.legs || []) {
    for (const s of leg.steps || []) {
      const m = s.maneuver || {};
      const [lng, lat] = m.location || [];
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      const distanceM = Math.round(s.distance || 0);

      let type = 'turn';
      let turn = TURNS[m.modifier] || 'straight';
      if (m.type === 'depart') type = 'depart';
      else if (m.type === 'arrive') type = 'arrive';
      else if (m.type === 'roundabout' || m.type === 'rotary') turn = 'roundabout';
      else if (m.type === 'exit roundabout' || m.type === 'exit rotary') turn = 'straight';

      if (type === 'turn' && turn === 'straight' && steps.length) {
        steps[steps.length - 1].distanceM += distanceM; // nothing to say: just keep walking
        continue;
      }
      const step = { type, turn: type === 'turn' ? turn : 'straight', lat, lng, distanceM };
      if (turn === 'roundabout' && Number.isFinite(m.exit)) step.exit = m.exit;
      steps.push(step);
    }
  }
  if (steps.length < 2) throw new Error('No walking route was found');
  if (steps[steps.length - 1].type !== 'arrive') {
    const last = route.geometry?.coordinates?.at(-1);
    if (last) steps.push({ type: 'arrive', turn: 'straight', lat: last[1], lng: last[0], distanceM: 0 });
  }

  // the line of the route (lat, lng pairs), thinned out to at most ~400 points
  const coords = route.geometry?.coordinates || [];
  const every = Math.max(1, Math.ceil(coords.length / 400));
  const path = coords.filter((_, i) => i % every === 0 || i === coords.length - 1).map(([lng, lat]) => [lat, lng]);

  return { distanceM: Math.round(route.distance || 0), durationS: Math.round(route.duration || 0), steps, path };
}

export async function fetchWalkingRoute(from, to, { fetchImpl = fetch } = {}) {
  const coords = `${from.lng},${from.lat};${to.lng},${to.lat}`;
  const url = process.env.MAPBOX_TOKEN
    ? `https://api.mapbox.com/directions/v5/mapbox/walking/${coords}?steps=true&geometries=geojson&overview=full&access_token=${process.env.MAPBOX_TOKEN}`
    : `${process.env.ROUTING_URL || DEFAULT_URL}/${coords}?steps=true&geometries=geojson&overview=full`;

  const res = await fetchImpl(url, { headers: { 'User-Agent': 'NestCare/1.0' }, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`The directions service is not available right now (${res.status})`);
  return parseRoute(await res.json());
}
