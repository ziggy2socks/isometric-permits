// Live helicopter data via ADS-B Exchange (adsb.lol)
// Polls every 12 seconds, shows up to MAX_HELIS over NYC

const NYC_LAT = 40.75;
const NYC_LON = -74.00;
const DIST_NM = 25; // nautical miles radius
const MAX_HELIS = 10;
const HELI_TYPE_PREFIXES = ['H']; // ICAO type codes starting with H = helicopter

export interface HelicopterState {
  hex: string;
  lat: number;
  lon: number;
  alt: number;       // feet
  track: number;     // degrees
  gs: number;        // knots ground speed
}

export async function fetchHelicopters(): Promise<HelicopterState[]> {
  try {
    const res = await fetch(
      `https://api.adsb.lol/v2/lat/${NYC_LAT}/lon/${NYC_LON}/dist/${DIST_NM}`,
      { cache: 'no-store' }
    );
    if (!res.ok) return [];
    const data = await res.json();
    const ac: any[] = data.ac ?? [];

    const helis = ac.filter(a => {
      const t: string = a.t ?? '';
      const isHeliType = HELI_TYPE_PREFIXES.some(p => t.startsWith(p));
      const alt = typeof a.alt_baro === 'number' ? a.alt_baro : null;
      const gs = typeof a.gs === 'number' ? a.gs : 999;
      // Include: known heli types, OR low+slow (alt < 2500ft, gs < 120kts) with valid coords
      const isLowSlow = alt !== null && alt !== 'ground' && alt < 2500 && gs < 120;
      return (isHeliType || isLowSlow) && a.lat && a.lon && a.alt_baro !== 'ground';
    });

    // Sort by altitude ascending (lowest = most interesting, closest to map)
    helis.sort((a, b) => (a.alt_baro ?? 9999) - (b.alt_baro ?? 9999));

    return helis.slice(0, MAX_HELIS).map(a => ({
      hex: a.hex,
      lat: a.lat,
      lon: a.lon,
      alt: typeof a.alt_baro === 'number' ? a.alt_baro : 0,
      track: a.track ?? 0,
      gs: a.gs ?? 0,
    }));
  } catch {
    return [];
  }
}
