# Flock Finder — frontend

React Native + Expo app for the Flock Camera Project. Shows ALPR / Flock cameras around UTD on a map and in AR.

## Run it

```bash
cd frontend
npm install
npx expo start
```

Scan the QR code with **Expo Go** on your phone (same Wi‑Fi as your laptop). The camera and sensors need a real phone, not a simulator.

## What's in it (from the whiteboard "Min" list)

| Whiteboard | Where |
|---|---|
| AR app with camera relation | `src/screens/ARScreen.tsx` — thin client. Sends a base64 frame + raw GPS + raw rotation/motion sensors to the backend about once a second, then draws exactly what comes back (boxes, `alert` vignette, `message`). |
| Slider with radius for detection (0.5–5 mi) | `src/components/RadiusSlider.tsx` — the value is sent to the backend as `radius_m` |
| GPS map | `src/screens/MapScreen.tsx` — shows the cameras the backend returns for your position |
| Status bar | `src/components/StatusBar.tsx` — shows the backend's nearest camera and alert flag |
| Settings: Map/AR toggle, radius, units, pedestrian/driver | `src/screens/SettingsScreen.tsx` |

**The phone does no math.** Distance, filtering, sorting, alerts and detection all happen on the backend.

## Raw data the phone sends

Collected in `src/sensors.ts`, sent by `src/api.ts`:

- **Frame** — JPEG, 640 px wide, base64, with its width/height and the camera's full capture width/height
- **Timestamps** — `ts` (wall clock, ms) and `monotonic_ms` (monotonic clock at capture)
- **Location** — latitude, longitude, altitude, accuracy, speed, course
- **Compass** — magnetic and true heading
- **DeviceMotion** — rotation (alpha/beta/gamma, radians), rotationRate (gyroscope, deg/s), acceleration, accelerationIncludingGravity, screen orientation
- **Magnetometer** — raw x/y/z in μT
- **Settings** — radius_m, mode

## Talking to the backend

Matches the FastAPI app in `backend/app`. Set the server URL in **Settings → Detector server** (default in `src/config.ts`); paths live in `PATHS` in `src/api.ts`.

- `POST /images/process-base64` — sends `{ image: <base64 jpeg>, ...sensor data }` (see `sample_payload.json`). The backend currently reads only `image` and returns `{ image }`, a processed frame the AR view shows as a "Model output" thumbnail (tap for full screen). If the backend later adds `detections`, `alert` or `message` to the response, the app draws them automatically.
- `GET /health` — drives the "API live / down" indicator.
- `GET /cameras?lat&lon&radius_m&mode` — not on the backend yet; the map stays empty until it exists.

## Later (from the whiteboard)

Map rerouting, notifications, 3D cone model for AR, video, Ras + multiple data.
