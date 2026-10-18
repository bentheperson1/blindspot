import { MILE } from './config';
import type { LatLng, Units } from './types';

/** Display only: turns a backend-provided distance in meters into a label. */
export function formatDistance(m: number, units: Units): string {
  // Rounded so small GPS wobble doesn't flicker the label: feet to the nearest 10 (25 above 500 ft), meters to the nearest 5.
  if (units === 'metric') return m < 1000 ? `${Math.round(m / 5) * 5} m` : `${(m / 1000).toFixed(1)} km`;
  const mi = m / MILE;
  if (mi >= 0.1) return `${mi.toFixed(1)} mi`;
  const ft = m * 3.28084;
  return `${Math.round(ft / (ft > 500 ? 25 : 10)) * (ft > 500 ? 25 : 10)} ft`;
}

const M_PER_DEG_LAT = 111_320;

/**
 * A field-of-view wedge for a camera: apex at the camera, opening `fovDeg` wide
 * centered on `headingDeg` (compass degrees, 0 = north, clockwise), reaching `rangeM` meters.
 * Returns the apex followed by an arc of points so the far edge is curved. The small-distance
 * flat-earth approximation is plenty accurate at the tens-of-meters scale of a camera's view.
 */
export function fovPolygon(lat: number, lon: number, headingDeg: number, fovDeg: number, rangeM: number, steps = 12): LatLng[] {
  const mPerDegLon = M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);
  const pointAt = (bearingDeg: number): LatLng => {
    const b = (bearingDeg * Math.PI) / 180;
    return {
      latitude: lat + (rangeM * Math.cos(b)) / M_PER_DEG_LAT,
      longitude: lon + (rangeM * Math.sin(b)) / mPerDegLon,
    };
  };
  const start = headingDeg - fovDeg / 2;
  const coords: LatLng[] = [{ latitude: lat, longitude: lon }];
  for (let i = 0; i <= steps; i++) coords.push(pointAt(start + (fovDeg * i) / steps));
  return coords;
}