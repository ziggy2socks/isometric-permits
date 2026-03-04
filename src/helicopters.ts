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
      track: a.track ?? 0,
      gs: a.gs ?? 0,
    }));
  } catch {
    return [];
  }
}
