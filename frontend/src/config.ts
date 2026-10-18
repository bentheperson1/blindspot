// Central config. Change API_URL to wherever the FastAPI server runs.
// On a physical phone, "localhost" is the phone itself — use your laptop's LAN IP
// (e.g. http://192.168.1.20:8000) or the LinuxONE server's public IP.
export const DEFAULT_API_URL = 'http://172.20.10.4:8000';

// Where the map opens before GPS arrives.
export const UTD_CENTER = { latitude: 32.9857, longitude: -96.7502 };

// Slider range from the whiteboard: 0.5 mi — 5 mi (sent to the backend in meters).
export const MILE = 1609.344;
export const RADIUS_MIN_M = 0.5 * MILE;
export const RADIUS_MAX_M = 5 * MILE;

// AR frame upload: one frame at a time, then wait this long before the next.
export const FRAME_INTERVAL_MS = 10;
export const FRAME_WIDTH_PX = 640;
export const FRAME_JPEG_QUALITY = 0.6;

// Map: how often to re-ask the backend for nearby cameras.
export const CAMERA_REFRESH_MS = 50;
