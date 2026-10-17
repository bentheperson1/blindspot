import type { Telemetry } from './sensors';
import type { Camera, Detection, TravelMode } from './types';

/**
 * Request body for every frame, matching the backend schema:
 *
 *   lat: float
 *   long: float
 *   gps_accuracy: float | None      meters (GPS fix accuracy radius)
 *   roll: float                     degrees
 *   pitch: float                    degrees
 *   yaw: float                      degrees, compass heading, 0 = north, clockwise
 *   heading_accuracy: float | None  degrees, compass noise estimate
 *   frame: str | None               base64 jpeg, omitted when no frame is sent
 *   timestamp: float                unix seconds, client side
 *
 * Extra context goes under `extra` (Pydantic ignores it unless the backend adds it):
 *   width/height of the sent frame, camera_width/camera_height, monotonic_ms, platform, settings.
 *
 * Unit conversions only (no geometry): DeviceMotion gives radians, the schema wants degrees.
 *   pitch = rotation.beta  (tilt forward/back, around the device's x-axis)
 *   roll  = rotation.gamma (tilt left/right, around the device's y-axis)
 *   yaw   = compass trueHeading, falling back to magHeading when true north is unavailable (-1)
 */
export type FramePayload = {
  lat: number;
  long: number;
  gps_accuracy: number | null;
  roll: number;
  pitch: number;
  yaw: number;
  heading_accuracy: number | null;
  frame?: string;
  timestamp: number;
  extra: Record<string, unknown>;
};

// Backend URL paths.
export const PATHS = {
  frame: '/images/process-base64',
  health: '/health',
  cameras: '/cameras',
};

/**
 * The current /images/process-base64 endpoint requires the frame under `image`.
 * While this is true, the frame is also sent as `image`. Set to false once the
 * backend reads `frame`, to stop sending the image twice.
 */
export const SEND_LEGACY_IMAGE_FIELD = true;

export type FrameResult = {
  image?: string; // processed frame from the backend, base64 jpeg
  detections: Detection[];
  alert?: boolean;
  message?: string;
};

const RAD_TO_DEG = 180 / Math.PI;

/**
 * expo-location reports compass calibration as a level 0–3 on both iOS and Android.
 * Expo documents these uncertainty bounds per level: 3 < 20°, 2 < 35°, 1 < 50°, 0 > 50°.
 * We send the upper bound in degrees; level 0 (uncalibrated) is sent as 180.
 */
const HEADING_ACCURACY_DEG: Record<number, number> = { 3: 20, 2: 35, 1: 50, 0: 180 };

/**
 * Builds the schema payload. Returns null when a required field isn't available yet
 * (no GPS fix, no compass, or no motion reading), so we never send fake values.
 */
export function buildPayload(
  telemetry: Telemetry,
  frame: { base64: string; width: number; height: number; cameraWidth: number; cameraHeight: number } | null,
  capture: { timestampSec: number; monotonicMs: number },
  context: { platform: string; settings: { radius_m: number; mode: TravelMode } },
): FramePayload | null {
  const loc = telemetry.location;
  const rot = telemetry.motion?.rotation;
  const compass = telemetry.compass;
  if (!loc || !rot || !compass) return null;

  const yaw = compass.trueHeading >= 0 ? compass.trueHeading : compass.magHeading;

  const payload: FramePayload = {
    lat: loc.latitude,
    long: loc.longitude,
    gps_accuracy: loc.accuracy ?? null,
    roll: rot.gamma * RAD_TO_DEG,
    pitch: rot.beta * RAD_TO_DEG,
    yaw,
    heading_accuracy: HEADING_ACCURACY_DEG[Math.round(compass.accuracy)] ?? null,
    timestamp: capture.timestampSec,
    extra: {
      platform: context.platform,
      monotonic_ms: capture.monotonicMs,
      settings: context.settings,
      ...(frame && { width: frame.width, height: frame.height, camera_width: frame.cameraWidth, camera_height: frame.cameraHeight }),
    },
  };
  if (frame) payload.frame = frame.base64;
  return payload;
}

export async function sendFrame(apiUrl: string, payload: FramePayload): Promise<FrameResult> {
  const body = JSON.stringify(SEND_LEGACY_IMAGE_FIELD && payload.frame ? { ...payload, image: payload.frame } : payload);
  const res = await request(`${base(apiUrl)}${PATHS.frame}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }, 8000);
  const json = (await res.json()) as Partial<FrameResult>;
  return { image: json.image, detections: json.detections ?? [], alert: json.alert, message: json.message };
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
