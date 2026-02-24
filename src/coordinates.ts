import type { MapConfig } from './types';

// Ported from Python: src/isometric_nyc/generation/shared.py
// latlng_to_quadrant_coords()
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

  // Inverse rotation by azimuth
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
  const quadrantStepXPx = width_px * tile_step;
  const quadrantStepYPx = height_px * tile_step;

  const qx = shiftXPx / quadrantStepXPx;
  const qy = -shiftYPx / quadrantStepYPx;

  return { qx, qy };
}

// Each quadrant is 512px in the final assembled image
export const QUADRANT_PX = 512;

export function quadrantToImagePixel(qx: number, qy: number): { x: number; y: number } {
  return { x: qx * QUADRANT_PX, y: qy * QUADRANT_PX };
}
