import type { MapConfig } from './types';

/**
 * Coordinate projection for isometric-nyc.
 *
 * Ports latlng_to_quadrant_coords() from isometric-nyc/generation/shared.py,
 * with seed pixel position calibrated from 15 ground-truth points across
 * all 5 NYC boroughs + NJ.
 *
 * ═══ GENERATION CONFIG (from tiny-nyc/generation_config.json) ═══
 *   seed:                    { lat: 40.7484, lng: -73.9857 }  (~Empire State Building)
 *   camera_azimuth_degrees:  -15
 *   camera_elevation_degrees: -45
 *   width_px: 1024, height_px: 1024
 *   view_height_meters: 300
 *   tile_step: 0.5
 *   Assembled image: 123904 × 100864 px = 242 × 197 quadrants at 512px each
 *
 * ═══ CALIBRATION ═══
 *   15 points measured via OSD click logger (window.__osd), tagged with
 *   Google Maps lat/lng. Least-squares solve for SEED_PX.
 *   RMS residual: 28px (~8m) across full NYC metro. Max: 63px (~18m).
 *   Projection is isotropic: mpp_x ≈ mpp_y ≈ 0.293 m/px.
 *
 * ═══ CRITICAL: OSD VIEWPORT COORDINATES ═══
 *   OpenSeadragon uses image WIDTH as the unit for BOTH axes.
 *   To convert image pixel → OSD viewport point:
 *     vpX = imgX / IMAGE_DIMS.width   ✓
 *     vpY = imgY / IMAGE_DIMS.width   ✓  (divide by WIDTH, not height!)
 *   Dividing vpY by IMAGE_DIMS.height instead gives a ~22% downward offset
 *   because height (100864) ≠ width (123904).
 *
 * ═══ FORMULA ═══
 *   1. deltaNorth/East from seed in meters
 *   2. Rotate by camera azimuth → (rotX, rotY)
 *   3. shiftRight = rotX;  shiftUp = -rotY * sin(elevation)
 *   4. Convert to pixels: shift / (view_height_meters / height_px)
 *   5. Convert to quadrants: px / (width_px * tile_step)  [= px / 512]
 *   6. Image pixel = SEED_PX + quadrant * 512
 */
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
