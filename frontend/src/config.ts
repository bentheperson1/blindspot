// Central config. Change API_URL to wherever the FastAPI server runs.
// On a physical phone, "localhost" is the phone itself — use your laptop's LAN IP
// (e.g. http://192.168.1.20:8000) or the LinuxONE server's public IP.
export const DEFAULT_API_URL = 'http://11.24.6.248:8000';

// Where the map opens before GPS arrives.
export const UTD_CENTER = { latitude: 32.9857, longitude: -96.7502 };

// Slider range from the whiteboard: 0.5 mi — 5 mi (sent to the backend in meters).
export const MILE = 1609.344;
export const RADIUS_MIN_M = 0.5 * MILE;
export const RADIUS_MAX_M = 5 * MILE;

// AR frame upload: one frame at a time, then wait this long before the next.
// Each upload takes a full photo, which briefly stalls the camera preview, so keep this slow.
export const FRAME_INTERVAL_MS = 5000;
// Set to false to stop photo uploads entirely (smoothest camera view). Markers don't need them.
export const SEND_FRAMES = true;

// Camera list cache for the Camera tab: how often to re-download nearby cameras (lat/long) from the backend.
// In between, markers are placed on the phone from the cached list ~10×/s, with no network calls.
export const CAMERA_LIST_REFRESH_MS = { pedestrian: 30_000, driver: 5_000 } as const;
// Also re-download early if you've moved this far (as a fraction of the search radius) since the last download.
export const CAMERA_LIST_MOVE_FRACTION = 0.25;
// How often markers are re-placed from the cached list.
export const MARKER_UPDATE_MS = 100;

// Marker accuracy.
// Heading smoothing: the gyro tracks quick turns; the compass only slowly corrects it toward north.
// Fraction of the gap closed per marker update (0.08 at 10×/s ≈ settles in ~1.5 s). Lower = steadier, slower to correct.
export const HEADING_SMOOTHING = 0.08;
// Heights used to place markers vertically: Flock cameras sit high on poles; the phone is held around chest height.
export const CAMERA_MOUNT_HEIGHT_M = 4.5;
export const PHONE_HEIGHT_M = 1.4;
export const FRAME_WIDTH_PX = 640;
export const FRAME_JPEG_QUALITY = 0.6;

// Map: how often to re-ask the backend for nearby cameras.
export const CAMERA_REFRESH_MS = 5000;

// Field-of-view wedge drawn on the map for each camera, from its stored heading.
// Tune these two to change how the wedge looks: CAMERA_FOV_DEG is the opening angle,
// CAMERA_FOV_RANGE_M is how far it reaches.
export const CAMERA_FOV_DEG = 45;
export const CAMERA_FOV_RANGE_M = 75;