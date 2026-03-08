// Live helicopter data via ADS-B Exchange (adsb.lol)
// Polls every 12 seconds, shows up to MAX_HELIS over NYC

const NYC_LAT = 40.75;
const NYC_LON = -74.00;
const DIST_NM = 25; // nautical miles radius
const MAX_HELIS = 10;

// Known helicopter ICAO type codes (Bell, Airbus, Sikorsky, Robinson, etc.)
const HELI_TYPES = new Set([
  'H25B','H500','H60','H64','H69','H72','H76','H47',
  'B06','B06X','B07','B212','B222','B230','B407','B412','B427','B429','B430','B47G','B47J',
  'EC20','EC25','EC30','EC35','EC45','EC55','EC75','EC30','AS32','AS35','AS50','AS55','AS65',
  'S300','S330','S333','S61','S64','S70','S76','S92',
  'R22','R44','R66',
  'AW09','AW19','AW89','AW01','AW39',
  'MD52','MD60','MD83',
  'EN28','EN48',
  'K126','K135','K232',
]);

export interface HelicopterState {
  hex: string;
  lat: number;
  lon: number;
  alt: number;       // feet
  alt_baro?: number; // feet (barometric)
  track: number;     // degrees (0=N, 90=E, 180=S, 270=W)
  gs: number;        // knots ground speed
  flight?: string;   // callsign/flight number
  t?: string;        // ICAO aircraft type code (e.g. "B407", "S76")
  r?: string;        // tail number / registration (e.g. "N911NY")
}

// Test helicopters — used for UI preview only, remove before launch
export const TEST_HELICOPTERS: HelicopterState[] = [
  {
    hex: 'a1b2c3',
    lat: 40.6892,   // Statue of Liberty
    lon: -74.0445,
    alt: 800, alt_baro: 800, track: 45, gs: 85,
    flight: 'NYPD3', t: 'B407', r: 'N911NY',
  },
  {
    hex: 'd4e5f6',
    lat: 40.7580,   // Midtown Manhattan / 30 Rock
    lon: -73.9855,
    alt: 1200, alt_baro: 1200, track: 200, gs: 110,
    flight: 'WABC1', t: 'EC35', r: 'N7NY',
  },
];

// Keep singular export for any legacy references
export const TEST_HELICOPTER = TEST_HELICOPTERS[0];

export async function fetchHelicopters(): Promise<HelicopterState[]> {
  try {
    const res = await fetch(
      `/api/adsb/lat/${NYC_LAT}/lon/${NYC_LON}/dist/${DIST_NM}`,
      { cache: 'no-store' }
    );
    if (!res.ok) return [];
    const data = await res.json();
    const ac: any[] = data.ac ?? [];

    const helis = ac.filter(a => {
      const t: string = (a.t ?? '').toUpperCase();
      const isHeliType = HELI_TYPES.has(t) || t.startsWith('H');
      const notGround = a.alt_baro !== 'ground' && typeof a.alt_baro === 'number';
      return isHeliType && notGround && a.lat && a.lon;
    });

    // Sort by altitude ascending (lowest = most interesting, closest to map)
    helis.sort((a, b) => (a.alt_baro ?? 9999) - (b.alt_baro ?? 9999));

    return helis.slice(0, MAX_HELIS).map(a => ({
      hex: a.hex,
      lat: a.lat,
      lon: a.lon,
      alt: typeof a.alt_baro === 'number' ? a.alt_baro : 0,
      alt_baro: typeof a.alt_baro === 'number' ? a.alt_baro : undefined,
      track: typeof a.track === 'number' ? a.track : 0,
      gs: typeof a.gs === 'number' ? a.gs : 0,
      flight: typeof a.flight === 'string' ? a.flight.trim() : undefined,
      t: typeof a.t === 'string' ? a.t.toUpperCase() : undefined,
      r: typeof a.r === 'string' ? a.r.trim() : undefined,
    }));
  } catch {
    return [];
  }
}
