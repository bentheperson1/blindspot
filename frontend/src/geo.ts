import { MILE } from './config';
import type { Units } from './types';

/** Display only: turns a backend-provided distance in meters into a label. */
export function formatDistance(m: number, units: Units): string {
  if (units === 'metric') return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;
  const mi = m / MILE;
  return mi < 0.1 ? `${Math.round(m * 3.28084)} ft` : `${mi.toFixed(1)} mi`;
}
