import type { MapConfig } from './types';

/**
 * Coordinate projection for isometric-nyc.
 *
 * This is a direct port of latlng_to_quadrant_coords() from:
 *   src/isometric_nyc/generation/shared.py
 *
 * Generation config (from tiny-nyc/generation_config.json):
 *   seed: { lat: 40.7484, lng: -73.9857 }   // ~Empire State Building
 *   camera_azimuth_degrees: -15
 *   camera_elevation_degrees: -45
 *   width_px: 1024, height_px: 1024
 *   view_height_meters: 300
 *   tile_step: 0.5
 *
 * Assembled image: 123904 x 100864 px = 242 x 197 quadrants at 512px each.
 *
 * Seed pixel position calibrated from two ground-truth permit locations:
 *   A: 462 First Ave Manhattan (40.7416, -73.9742) → image px (46865, 46242)
 *   B: 109 Rockaway Point Blvd Queens (40.5608, -73.9200) → image px (45021, 95656)
 *   Average seed: (44770, 43740)
 *
 * Formula derivation (from Python source):
 *   1. delta_north/east from seed in meters
 *   2. Rotate by camera azimuth → (delta_rot_x, delta_rot_y)
 *   3. delta_rot_x → shift right in camera space
 *      delta_rot_y * sin(elevation) → shift up in camera space
 *   4. Convert shifts to pixels: shift / (view_height / height_px)
 *   5. Convert pixels to quadrants: px / (width_px * tile_step) = px / 512
 *   6. Image pixel = seed_px + quadrant * 512
 */

// Production config solved via least-squares from 15 calibrated ground-truth points
// spread across all 5 NYC boroughs + NJ.
//
// Key finding: mpp_x ≈ mpp_y ≈ 0.293 m/px — the projection is nearly ISOTROPIC,
// not anisotropic as previously assumed. The camera view is ~300m wide × ~424m tall
// (raw mpp_y*1024 = 299.7m; sin(45°) foreshortening gives 424m effective height).
//
// RMS fit error: 28px = ~8 meters across the full NYC metro area.
// Max error: 63px (~18m) at City Island, Bronx.
//
// Calibration data: 15 points measured via OSD console click logger,
// tagged with Google Maps lat/lng for each building.
export const MAP_CONFIG: MapConfig = {
  seed: { lat: 40.7484, lng: -73.9857 },
  camera_azimuth_degrees: -15,
  camera_elevation_degrees: -45,
  width_px: 1024,
  height_px: 1024,
  view_height_meters: 300,
  tile_step: 0.5,
};

// Seed pixel position from 15-point least-squares fit.
// Agrees well with tiles_metadata.json origin: (-87, -84) → (44544, 43008)
export const SEED_PX = { x: 45059, y: 43479 };

export const IMAGE_DIMS = { width: 123904, height: 100864 };

/**
 * Convert a lat/lng to quadrant coordinates relative to the seed.
 * Exact port of latlng_to_quadrant_coords() from shared.py.
 */
export function latlngToQuadrantCoords(
  config: MapConfig,
  lat: number,
  lng: number
): { qx: number; qy: number } {
  const {
    seed,
    camera_azimuth_degrees,
    camera_elevation_degrees,
    width_px,
    height_px,
    view_height_meters,
    tile_step,
  } = config;

  const metersPerPixel = view_height_meters / height_px;

  // Convert lat/lng difference to meters
  const deltaNorthMeters = (lat - seed.lat) * 111111.0;
  const deltaEastMeters =
    (lng - seed.lng) * 111111.0 * Math.cos((seed.lat * Math.PI) / 180);

  // Inverse rotation by azimuth (from shared.py: matches calculate_offset inverse)
  const azimuthRad = (camera_azimuth_degrees * Math.PI) / 180;
  const cosA = Math.cos(azimuthRad);
  const sinA = Math.sin(azimuthRad);

  const deltaRotX = deltaEastMeters * cosA - deltaNorthMeters * sinA;
  const deltaRotY = deltaEastMeters * sinA + deltaNorthMeters * cosA;

  // Convert to pixel shifts
  const elevRad = (camera_elevation_degrees * Math.PI) / 180;
  const sinElev = Math.sin(elevRad);

  const shiftRightMeters = deltaRotX;
  const shiftUpMeters = -deltaRotY * sinElev;

  const shiftXPx = shiftRightMeters / metersPerPixel;
  const shiftYPx = shiftUpMeters / metersPerPixel;

  // Convert to quadrant coordinates
  const quadrantStepPx = width_px * tile_step; // 512

  const qx = shiftXPx / quadrantStepPx;
  const qy = -shiftYPx / quadrantStepPx; // negative: y increases downward

  return { qx, qy };
}

/**
 * Convert lat/lng directly to image pixel coordinates.
 * Uses the calibrated seed pixel position.
 */
export function latlngToImagePx(lat: number, lng: number): { x: number; y: number } {
  const { qx, qy } = latlngToQuadrantCoords(MAP_CONFIG, lat, lng);
  return {
    x: SEED_PX.x + qx * 512,
    y: SEED_PX.y + qy * 512,
  };
}

// Legacy compat
export const QUADRANT_PX = 512;
export function quadrantToImagePixel(qx: number, qy: number): { x: number; y: number } {
  return { x: qx * QUADRANT_PX, y: qy * QUADRANT_PX };
}
