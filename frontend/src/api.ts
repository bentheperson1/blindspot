import type { Telemetry } from './sensors';
import type { Camera, Detection, TravelMode } from './types';

/**
 * Matches the backend in backend/app (FastAPI, router prefix "/images").
 *
 * POST {apiUrl}/images/process-base64      application/json
 *   Backend reads today:   { "image": "<base64 jpeg>" }
 *   We also send (ignored by the backend until it adds these fields to Base64ImageRequest):
 *     width, height                  size of the encoded frame in `image`
 *     camera_width, camera_height    full resolution the camera captured, before resizing
 *     ts                             wall clock, ms since epoch (Date.now)
 *     monotonic_ms                   monotonic clock at the moment of capture (performance.now) —
 *                                    never jumps backwards, use it to order frames and measure gaps
 *     location, locationTimestamp, compass, motion, magnetometer, settings
 *   See sample_payload.json for a full example.
 *
 *   Backend returns today: { "image": "<base64 jpeg>" }   — the processed frame
 *   We also read, if the backend adds them later:
 *     detections: [{ label, confidence, box: [x, y, w, h] }]   (box normalized 0–1)
 *     alert: boolean, message: string
 *
 * GET {apiUrl}/health                       — used for the "API live / down" indicator
 * GET {apiUrl}/cameras?lat&lon&radius_m&mode — not built on the backend yet; map shows nothing until it is
 */
export const PATHS = {
  frame: '/images/process-base64',
  health: '/health',
  cameras: '/cameras',
};

export type CameraDot = { name: string; x: number; y: number, distance_to_user: number };

export type FrameResult = {
  detections: Detection[];
  dots: CameraDot[]; // empty when no camera is in view
  alert?: boolean;
  message?: string;
};

export async function sendFrame(
  apiUrl: string,
  frame: { cameraWidth: number; cameraHeight: number; monotonicMs: number; ts: number },
  telemetry: Telemetry,
  settings: { radius_m: number; mode: TravelMode },
  cameras: Camera[],
): Promise<FrameResult> {
  const body = JSON.stringify({
    camera_width: frame.cameraWidth,
    camera_height: frame.cameraHeight,
    ts: frame.ts,
    monotonic_ms: frame.monotonicMs,
    ...telemetry,
    settings,
    flock_cameras: cameras,
  });
  const res = await request(`${base(apiUrl)}${PATHS.frame}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }, 8000);
  const json = (await res.json()) as Partial<FrameResult>;
  const dots = (json.dots ?? []).filter((d) => typeof d.x === 'number' && typeof d.y === 'number' && typeof d.distance_to_user === 'number');
  return { detections: json.detections ?? [], dots, alert: json.alert, message: json.message };
}

export async function checkHealth(apiUrl: string): Promise<boolean> {
  try {
    await request(`${base(apiUrl)}${PATHS.health}`, {}, 4000);
    return true;
  } catch {
    return false;
  }
}

/** Returns [] if the backend has no /cameras endpoint yet. */
export async function fetchCameras(
  apiUrl: string,
  q: { lat: number; lon: number; radius_m: number; mode: TravelMode },
): Promise<Camera[]> {
  try {
    const qs = `lat=${q.lat}&lon=${q.lon}&radius_m=${Math.round(q.radius_m)}&mode=${q.mode}`;
    const res = await request(`${base(apiUrl)}${PATHS.cameras}?${qs}`, {}, 6000);
    const json = await res.json();
    return Array.isArray(json) ? (json as Camera[]) : [];
  } catch {
    return [];
  }
}

const base = (u: string) => u.replace(/\/$/, '');

async function request(url: string, init: RequestInit, ms: number) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res;
  } finally {
    clearTimeout(t);
  }
}
