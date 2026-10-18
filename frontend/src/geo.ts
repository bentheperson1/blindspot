import { MILE } from './config';
import type { Units } from './types';

/** Display only: turns a backend-provided distance in meters into a label. */
export function formatDistance(m: number, units: Units): string {
  // Rounded so small GPS wobble doesn't flicker the label: feet to the nearest 10 (25 above 500 ft), meters to the nearest 5.
  if (units === 'metric') return m < 1000 ? `${Math.round(m / 5) * 5} m` : `${(m / 1000).toFixed(1)} km`;
  const mi = m / MILE;
  if (mi >= 0.1) return `${mi.toFixed(1)} mi`;
  const ft = m * 3.28084;
  return `${Math.round(ft / (ft > 500 ? 25 : 10)) * (ft > 500 ? 25 : 10)} ft`;
}