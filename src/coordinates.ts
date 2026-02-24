import type { MapConfig } from './types';

// Calibrated from two ground-truth points (462 First Ave + 109 Rockaway Point Blvd)
// using exact OSD image coordinates.
//
// Key finding: the camera's view is NOT square in world space.
// view_height_meters = 300m  → mpp_y = 300/1024 = 0.2930
// view_width_meters  = 440m  → mpp_x = 440/1024 = 0.4293
// This 1.47:1 aspect ratio is from the Google Maps 3D tiles orthographic camera.
//
// Formula: img_px_x = rx / mpp_x   (rx = camera-right component)
//          img_px_y = -shift_up / mpp_y = ry * sin(el) / mpp_y ... but careful with sign

const MPP_X = 0.429295;  // meters per pixel in X direction (view_width=440m / 1024px)
const MPP_Y = 0.292969;  // meters per pixel in Y direction (view_height=300m / 1024px)

export function latlngToImageOffset(
  config: MapConfig,
  lat: number,
  lng: number
): { x: number; y: number } {
  const { seed, camera_azimuth_degrees, camera_elevation_degrees } = config;

  // Convert lat/lng difference to meters
  const deltaNorthMeters = (lat - seed.lat) * 111111.0;
  const deltaEastMeters =
    (lng - seed.lng) * 111111.0 * Math.cos((seed.lat * Math.PI) / 180);

  // Rotate by camera azimuth
  const azimuthRad = (camera_azimuth_degrees * Math.PI) / 180;
  const cosA = Math.cos(azimuthRad);
  const sinA = Math.sin(azimuthRad);

  const rx = deltaEastMeters * cosA - deltaNorthMeters * sinA; // camera-right
  const ry = deltaEastMeters * sinA + deltaNorthMeters * cosA; // camera-forward

  // Apply elevation for Y (foreshortening)
  const elevRad = (camera_elevation_degrees * Math.PI) / 180;
  const sinElev = Math.sin(elevRad);

  // Image pixel offset from seed
  const imgX = rx / MPP_X;
  const imgY = -(-ry * sinElev) / MPP_Y;  // shift_up = -ry*sinElev; img_y = -shift_up/mpp

  return { x: imgX, y: imgY };
}

// Legacy compatibility — keep old name working
export function latlngToQuadrantCoords(
  config: MapConfig,
  lat: number,
  lng: number
): { qx: number; qy: number } {
  const { x, y } = latlngToImageOffset(config, lat, lng);
  return { qx: x / 512, qy: y / 512 };
}

export const QUADRANT_PX = 512;

export function quadrantToImagePixel(qx: number, qy: number): { x: number; y: number } {
  return { x: qx * QUADRANT_PX, y: qy * QUADRANT_PX };
}
