import type { CachedCamera } from './projection';
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
} & UserMessageFields;

/**
 * Fields the backend's POST /images/process-base64 actually validates (UserMessage in
 * backend/app/schemas/vision.py). Raw Expo sensor objects, rotation in radians, ints where the schema says int.
 * Sent alongside the fields above in the same body; Pydantic ignores whatever it doesn't use.
 */
type UserMessageFields = {
  camera_width: number;
  camera_height: number;
  ts: number; // unix ms, int
  monotonic_ms: number;
  location: Telemetry['location'];
  locationTimestamp: number | null; // int ms
  compass: { magHeading: number; trueHeading: number | null; accuracy: number | null } | null;
  motion: Telemetry['motion'];
  magnetometer: Telemetry['magnetometer'];
  settings: { radius_m: number; mode: TravelMode };
  radius_m: number;
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

/** A camera the backend placed in the frame: x/y are 0–1 within the camera view, distance in meters. */
export type FrameDot = { name: string; x: number; y: number; distance_to_user: number };

export type FrameResult = {
  image?: string; // processed frame from the backend, base64 jpeg
  detections: Detection[];
  dots?: FrameDot[]; // from /images/process-base64 (Base64ImageResponse.dots)
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
    // UserMessage fields for /images/process-base64
    camera_width: Math.round(frame?.cameraWidth ?? 0),
    camera_height: Math.round(frame?.cameraHeight ?? 0),
    ts: Math.round(capture.timestampSec * 1000),
    monotonic_ms: capture.monotonicMs,
    location: loc,
    locationTimestamp: telemetry.locationTimestamp != null ? Math.round(telemetry.locationTimestamp) : null,
    compass: { magHeading: compass.magHeading, trueHeading: compass.trueHeading, accuracy: compass.accuracy },
    motion: telemetry.motion,
    magnetometer: telemetry.magnetometer,
    settings: context.settings,
    radius_m: context.settings.radius_m,
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
  const json = (await res.json()) as Partial<FrameResult> & Record<string, unknown>;
  const dots = Array.isArray((json as { dots?: unknown }).dots) ? ((json as { dots: FrameDot[] }).dots) : [];
  return { image: json.image, detections: json.detections ?? [], dots, alert: json.alert, message: json.message };
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
    // The backend schema (InputInfo / LocationInputInfo) declares these as int; decimals get a 422.
    screen_w: Math.round(view.width),
    screen_h: Math.round(view.height),
    hfov: Math.round(view.hfov),
    radius: Math.round(radius_m),
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
 * The backend (project_to_screen) returns a list of { name, x, y, distance_to_user } with x/y as 0–1 fractions
 * of the screen. Off-screen entries and nulls (e.g. its [None, None] when a camera is behind you) are skipped.
 */
// The first /cameras/nearby call can be slow while the backend loads every camera from Firestore.
export const NEARBY_TIMEOUT_MS = 15000;

/** Result of one /cameras/nearby call: what to draw, plus counts for the on-screen status line. */
export type NearbyResult = { onScreen: ScreenCamera[]; inRange: number };

export async function fetchNearbyOnScreen(apiUrl: string, body: NearbyRequest): Promise<NearbyResult> {
  // Standalone call for POST /cameras/nearby (doesn't use the shared request() helper).
  // Body = exactly the backend's LocationInputInfo: 10 fields, all numbers.
  const url = `${apiUrl.trim().replace(/\/+$/, '')}/cameras/nearby`;
  const payload = {
    lat_p: Number(body.lat_p),
    lon_p: Number(body.lon_p),
    alpha: Number(body.alpha),
    beta: Number(body.beta),
    gamma: Number(body.gamma),
    compass_heading: Number(body.compass_heading),
    screen_w: Number(body.screen_w),
    screen_h: Number(body.screen_h),
    hfov: Number(body.hfov),
    radius: Number(body.radius),
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), NEARBY_TIMEOUT_MS);
  let res: Response;
  try {
    console.log('[nearby] ->', url, JSON.stringify(payload));
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'bypass-tunnel-reminder': '1' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (e) {
    console.log('[nearby] x  no response from', url, String(e));
    throw e;
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();
  console.log('[nearby] <-', res.status, text.slice(0, 300));
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 160)}`);

  let json: unknown = [];
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Server sent something that isn't JSON: ${text.slice(0, 80)}`);
  }

  // Backend returns a list of { name, x, y, distance_to_user }, x/y as 0–1 fractions of the screen.
  const list = Array.isArray(json) ? json : Array.isArray((json as { cameras?: unknown })?.cameras) ? (json as { cameras: unknown[] }).cameras : [];
  const out: ScreenCamera[] = [];
  list.forEach((raw, i) => {
    if (!raw || typeof raw !== 'object') return;
    const o = raw as Record<string, unknown>;
    const nx = pickNum(o, ['x', 'screen_x', 'px', 'u']);
    const ny = pickNum(o, ['y', 'screen_y', 'py', 'v']);
    if (nx == null || ny == null) return;
    if (nx < 0 || nx > 1 || ny < 0 || ny > 1) return; // off screen
    out.push({
      key: String(o.id ?? o.name ?? i),
      x: nx * payload.screen_w,
      y: ny * payload.screen_h,
      label: String(o.name ?? 'Flock camera'),
      distance_m: pickNum(o, ['distance_to_user', 'distance_m', 'distance']),
    });
  });
  return { onScreen: out, inRange: list.filter((c) => c && typeof c === 'object').length };
}

/**
 * POST /cameras/list -> raw cameras { name, latitude, longitude, heading } within `radius_m` of the phone.
 * The Camera tab caches this and projects markers on the phone. Throws `NoListEndpoint` on 404 (older backend),
 * so the app can fall back to calling /cameras/nearby.
 */
export class NoListEndpoint extends Error {}

export async function fetchCameraList(apiUrl: string, lat: number, lon: number, radius_m: number): Promise<CachedCamera[]> {
  const url = `${apiUrl.trim().replace(/\/+$/, '')}/cameras/list`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), NEARBY_TIMEOUT_MS);
  try {
    console.log('[list] ->', url, radius_m);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'bypass-tunnel-reminder': '1' },
      body: JSON.stringify({ lat_p: lat, lon_p: lon, radius: radius_m }),
      signal: controller.signal,
    });
    if (res.status === 404) throw new NoListEndpoint('backend has no /cameras/list');
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 160)}`);
    const json = JSON.parse(text) as unknown;
    const list = Array.isArray(json) ? json : [];
    const cams: CachedCamera[] = [];
    for (const raw of list) {
      if (!raw || typeof raw !== 'object') continue;
      const o = raw as Record<string, unknown>;
      const latitude = pickNum(o, ['latitude', 'lat']);
      const longitude = pickNum(o, ['longitude', 'lon', 'lng']);
      if (latitude == null || longitude == null) continue;
      cams.push({ name: String(o.name ?? 'Flock camera'), latitude, longitude, heading: pickNum(o, ['heading']) ?? undefined });
    }
    console.log('[list] <-', cams.length, 'cameras');
    return cams;
  } finally {
    clearTimeout(timer);
  }
}

/** The backend's verdict for a reported photo (POST /images/classify, ClassifyResponse). */
export type ClassifyResult = {
  isFlock: boolean;
  cameraType: string;
  confidence: number; // 0–1
  message: string | null;
};

/** How long to wait for a classify verdict. A real model may be slower than the stub. */
export const CLASSIFY_TIMEOUT_MS = 20000;

/**
 * POST /images/classify: send one photo (base64 jpeg) + the reporter's GPS and get back whether
 * the backend thinks it's a Flock camera. See backend app/api/routes/images.py -> classify.
 */
export async function classifyCamera(
  apiUrl: string,
  body: { image: string; lat: number | null; lon: number | null; gpsAccuracy?: number | null },
): Promise<ClassifyResult> {
  const url = `${apiUrl.trim().replace(/\/+$/, '')}/images/classify`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CLASSIFY_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'bypass-tunnel-reminder': '1' },
      body: JSON.stringify({ image: body.image, lat: body.lat, lon: body.lon, gps_accuracy: body.gpsAccuracy ?? null }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 160)}`);
  const json = JSON.parse(text) as Record<string, unknown>;
  return {
    isFlock: Boolean(json.is_flock),
    cameraType: typeof json.camera_type === 'string' ? json.camera_type : 'Unknown',
    confidence: typeof json.confidence === 'number' ? json.confidence : 0,
    message: typeof json.message === 'string' ? json.message : null,
  };
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
    // `bypass-tunnel-reminder` lets requests through a localtunnel address; harmless everywhere else.
    const headers: Record<string, string> = { ...((init.headers as Record<string, string> | undefined) ?? {}), 'bypass-tunnel-reminder': '1' };
    const res = await fetch(url, { ...init, headers, signal: ctrl.signal });
    if (!res.ok) {
      // Include the server's reason (FastAPI puts it in `detail`) so errors are readable on screen.
      let reason = '';
      try {
        const text = await res.text();
        try {
          const detail = (JSON.parse(text) as { detail?: unknown }).detail;
          reason = typeof detail === 'string' ? detail : JSON.stringify(detail ?? text);
        } catch {
          reason = text;
        }
      } catch {}
      throw new Error(`HTTP ${res.status}${reason ? `: ${reason.slice(0, 160)}` : ''}`);
    }
    return res;
  } finally {
    clearTimeout(t);
  }
}