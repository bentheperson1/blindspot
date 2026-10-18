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
 *   width/height of the sent frame, camera_width/camera_height, monotonic_ms, platform, settings,
 *   and `lens` (focal length etc. read from this frame's EXIF, see LensInfo).
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
  nearby: '/cameras/nearby', // backend: app/api/routes/cameras.py -> nearby(info: LocationInputInfo)
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
 * Camera lens data for one frame, copied straight from that photo's EXIF (no math).
 * Read on every frame, so it stays live if the phone switches lens or zooms.
 * Any field the phone doesn't report is null.
 *
 *   focal_length_mm     real focal length of the lens in mm (EXIF FocalLength)
 *   focal_length_35mm   35mm-equivalent focal length (EXIF FocalLengthIn35mmFilm / FocalLenIn35mmFilm)
 *   digital_zoom        EXIF DigitalZoomRatio (1 or 0 = no digital zoom)
 *   lens_model          EXIF LensModel (iPhone, e.g. "iPhone 15 back camera 6.1mm f/1.6")
 *   exif_width/height   pixel size of the photo the EXIF describes (before the 640 px resize)
 *   focal_plane_x_res, focal_plane_y_res, focal_plane_res_unit   sensor pixel density, when reported
 *   camera_zoom         the zoom the app asked the camera for (0 = none, 0–1 scale)
 */
export type LensInfo = {
  focal_length_mm: number | null;
  focal_length_35mm: number | null;
  digital_zoom: number | null;
  lens_model: string | null;
  exif_width: number | null;
  exif_height: number | null;
  focal_plane_x_res: number | null;
  focal_plane_y_res: number | null;
  focal_plane_res_unit: number | null;
  camera_zoom: number;
};

function num(v: unknown): number | null {
  const n = typeof v === 'string' ? parseFloat(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

/** Picks the lens fields out of an expo-camera EXIF object. iOS and Android use slightly different key names. */
export function lensFromExif(exif: Record<string, unknown> | undefined, cameraZoom: number): LensInfo {
  const e = exif ?? {};
  return {
    focal_length_mm: num(e.FocalLength),
    focal_length_35mm: num(e.FocalLengthIn35mmFilm ?? e.FocalLenIn35mmFilm),
    digital_zoom: num(e.DigitalZoomRatio),
    lens_model: typeof e.LensModel === 'string' ? e.LensModel : null,
    exif_width: num(e.PixelXDimension ?? e.ImageWidth),
    exif_height: num(e.PixelYDimension ?? e.ImageLength),
    focal_plane_x_res: num(e.FocalPlaneXResolution),
    focal_plane_y_res: num(e.FocalPlaneYResolution),
    focal_plane_res_unit: num(e.FocalPlaneResolutionUnit),
    camera_zoom: cameraZoom,
  };
}

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
  frame: { base64: string; width: number; height: number; cameraWidth: number; cameraHeight: number; lens?: LensInfo } | null,
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
      ...(frame?.lens && { lens: frame.lens }),
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

/**
 * Body for POST /cameras/nearby. Field names match the backend's LocationInputInfo
 * (read by _project -> project_to_screen in app/api/routes/cameras.py).
 *   lat_p, lon_p            phone GPS
 *   alpha, beta, gamma      DeviceMotion rotation, degrees (alpha = around z, beta = around x, gamma = around y)
 *   compass_heading         degrees, 0 = north, clockwise (same value as `yaw` in the frame payload)
 *   screen_w, screen_h      size of the camera view on screen, in the same units the app draws in (points)
 *   hfov                    horizontal field of view of the camera view on screen, degrees
 *   radius                  search radius, meters
 */
export type NearbyRequest = {
  lat_p: number;
  lon_p: number;
  alpha: number;
  beta: number;
  gamma: number;
  compass_heading: number;
  screen_w: number;
  screen_h: number;
  hfov: number;
  radius: number;
};

/** One camera placed on screen. x/y are screen points from the top-left of the camera view. */
export type ScreenCamera = {
  key: string;
  x: number;
  y: number;
  label: string;
  distance_m: number | null;
};

/** Builds the /cameras/nearby body from the latest sensor readings. Null until GPS, compass and motion are ready. */
export function buildNearbyRequest(
  telemetry: Telemetry,
  view: { width: number; height: number; hfov: number },
  radius_m: number,
): NearbyRequest | null {
  const loc = telemetry.location;
  const rot = telemetry.motion?.rotation;
  const compass = telemetry.compass;
  if (!loc || !rot || !compass) return null;
  return {
    lat_p: loc.latitude,
    lon_p: loc.longitude,
    alpha: rot.alpha * RAD_TO_DEG,
    beta: rot.beta * RAD_TO_DEG,
    gamma: rot.gamma * RAD_TO_DEG,
    compass_heading: compass.trueHeading >= 0 ? compass.trueHeading : compass.magHeading,
    screen_w: view.width,
    screen_h: view.height,
    hfov: view.hfov,
    radius: radius_m,
  };
}

const pickNum = (o: Record<string, unknown>, keys: string[]): number | null => {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
  }
  return null;
};

/**
 * Calls POST /cameras/nearby and returns the cameras that land on screen.
 * Accepts a plain list or { cameras: [...] }, and the common names for the screen position
 * (x/y, screen_x/screen_y, px/py, u/v). Entries marked not visible, or without a position, are skipped.
 */
export async function fetchNearbyOnScreen(apiUrl: string, body: NearbyRequest): Promise<ScreenCamera[]> {
  const res = await request(
    `${base(apiUrl)}${PATHS.nearby}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
    5000,
  );
  const json = (await res.json()) as unknown;
  const list = Array.isArray(json) ? json : Array.isArray((json as { cameras?: unknown })?.cameras) ? (json as { cameras: unknown[] }).cameras : [];
  const out: ScreenCamera[] = [];
  list.forEach((raw, i) => {
    if (!raw || typeof raw !== 'object') return;
    const o = raw as Record<string, unknown>;
    if (o.visible === false || o.on_screen === false || o.in_view === false) return;
    let x = pickNum(o, ['x', 'screen_x', 'px', 'u']);
    let y = pickNum(o, ['y', 'screen_y', 'py', 'v']);
    if (x == null || y == null) return;
    // If the backend sent fractions of the screen (0–1), turn them into points.
    if (x >= 0 && x <= 1 && y >= 0 && y <= 1) {
      x *= body.screen_w;
      y *= body.screen_h;
    }
    const cam = (o.camera && typeof o.camera === 'object' ? o.camera : o) as Record<string, unknown>;
    out.push({
      key: String(cam.id ?? o.id ?? i),
      x,
      y,
      label: String(cam.name ?? cam.label ?? o.name ?? 'Flock camera'),
      distance_m: pickNum(o, ['distance_m', 'distance', 'dist_m']) ?? pickNum(cam, ['distance_m', 'distance']),
    });
  });
  return out;
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
