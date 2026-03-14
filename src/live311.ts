// Live 311 complaint data — recent calls with lat/lon for pulse overlay

export interface Live311Call {
  key: string;
  lat: number;
  lon: number;
  type: string;
  createdAt: number; // JS timestamp ms
}

// Top complaint type colors (matches radar color scheme)
const TYPE_COLORS: Record<string, string> = {
  'Noise - Residential':           '#f97316',
  'HEAT/HOT WATER':                '#ef4444',
  'Illegal Parking':               '#eab308',
  'Blocked Driveway':              '#a855f7',
  'Noise - Street/Sidewalk':       '#fb923c',
  'UNSANITARY CONDITION':          '#84cc16',
  'Noise - Commercial':            '#f59e0b',
  'Street Light Condition':        '#facc15',
  'Noise - Vehicle':               '#f97316',
  'Dirty Conditions':              '#22d3ee',
  'Snow':                          '#93c5fd',
  'Water System':                  '#60a5fa',
};

export function getCallColor(type: string): string {
  return TYPE_COLORS[type] ?? '#00ccff';
}

export async function fetchRecent311(): Promise<Live311Call[]> {
  try {
    // Socrata dataset lags ~15-24h; use 4h window and strip tz suffix (Socrata needs bare ISO)
    const sinceRaw = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();
    const since = sinceRaw.replace('+00:00', '').replace('Z', '');
    const qs = [
      `$where=created_date>'${since}' AND latitude IS NOT NULL`,
      `$order=created_date DESC`,
      `$limit=100`,
      `$select=unique_key,latitude,longitude,complaint_type,created_date`,
    ].join('&');
    const res = await fetch(`/api/311?${qs}`, { cache: 'no-store' });
    if (!res.ok) return [];
    const rows: any[] = await res.json();
    return rows
      .filter(r => r.latitude && r.longitude)
      .map(r => ({
        key: r.unique_key ?? `${r.latitude}_${r.longitude}_${r.created_date}`,
        lat: parseFloat(r.latitude),
        lon: parseFloat(r.longitude),
        type: r.complaint_type ?? '',
        createdAt: new Date(r.created_date).getTime(),
      }))
      .filter(r => !isNaN(r.lat) && !isNaN(r.lon));
  } catch {
    return [];
  }
}

export async function fetchFerries(): Promise<{ lat: number; lon: number; heading: number; name?: string }[]> {
  // Try NYC Ferry public JSON feed
  const endpoints = [
    'https://s3.amazonaws.com/bktransit-gtfs/nyc-ferry/vehiclepositions.json',
    'https://dctu6gk73d2vg.cloudfront.net/gtfs-realtime/ferry-gtfs-rt/vehiclepositions.json',
  ];
  for (const url of endpoints) {
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) continue;
      const data = await res.json();
      // GTFS-RT JSON format: { entity: [{ vehicle: { position: { latitude, longitude, bearing }, vehicle: { label } } }] }
      const entities: any[] = data.entity ?? data.Entities ?? [];
      const vessels = entities
        .map((e: any) => e.vehicle ?? e.Vehicle)
        .filter(Boolean)
        .map((v: any) => ({
          lat:     v.position?.latitude  ?? v.Position?.Latitude,
          lon:     v.position?.longitude ?? v.Position?.Longitude,
          heading: v.position?.bearing   ?? v.Position?.Bearing ?? 0,
          name:    v.vehicle?.label      ?? v.Vehicle?.Label,
        }))
        .filter((v: any) => v.lat && v.lon);
      if (vessels.length > 0) return vessels;
    } catch { /* try next */ }
  }
  return [];
}
