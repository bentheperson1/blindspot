# blindspot — frontend

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
| Nearby sheet | `src/components/NearbySheet.tsx` — nearest camera, cameras in range, server status, radius slider |
| Settings: appearance (dark / light / match phone), radius, units, walking/driving, server address | `src/screens/SettingsScreen.tsx` (the Settings tab) |
| Navigation | Bottom tab bar in `src/components/ui.tsx` (`TabBar`): **Map · Camera · Settings**, always visible, icon + label |
| Look | `src/theme.tsx` — light + dark palettes made only from midnight indigo #282B4A, vanilla cream #EEEBDA and small red #B71947 highlights (the logo red) (plus tints/shades); one plain sans font (Archivo), flat cards, thin borders, no decoration. `src/components/ui.tsx` — buttons, chips, cards, tab bar, and the Blind Spot logo mark (the street camera) |

**The phone does no math.** Distance, filtering, sorting, alerts and detection all happen on the backend.

## What the phone sends

Built in `buildPayload` in `src/api.ts`, from readings collected in `src/sensors.ts`. Every field is read at the moment the frame is captured.

| Field | Type | Source |
|---|---|---|
| `lat`, `long` | float | GPS |
| `gps_accuracy` | float \| null | GPS accuracy radius, meters |
| `roll` | float | DeviceMotion `rotation.gamma`, converted to degrees |
| `pitch` | float | DeviceMotion `rotation.beta`, converted to degrees |
| `yaw` | float | Compass heading in degrees, 0 = north, clockwise (true north, or magnetic if true north is unavailable) |
| `heading_accuracy` | float \| null | Compass calibration level 0–3 converted to Expo's documented bounds: 3 → 20°, 2 → 35°, 1 → 50°, 0 → 180° |
| `frame` | string, optional | Base64 JPEG, 640 px wide. Omitted when no frame is sent |
| `timestamp` | float | Unix seconds, client clock |
| `extra` | object | `platform`, `monotonic_ms`, frame `width`/`height`, `camera_width`/`camera_height`, `settings`, `lens` |
| `extra.lens` | object | Read from **this frame's** photo EXIF, so it's live: `focal_length_mm`, `focal_length_35mm`, `digital_zoom`, `lens_model` (iPhone), `exif_width`/`exif_height`, focal-plane resolution if reported, and `camera_zoom` (fixed at 0). Missing fields are `null`. |

Nothing is sent until GPS, compass and motion all have a reading, so the required fields are never faked. See `sample_payload.json` for an example.

## Talking to the backend

Set the server URL in **Settings → Detector server** (default in `src/config.ts`). Paths are in `PATHS` in `src/api.ts`.

- `POST /images/process-base64` receives the payload above. The current endpoint reads the frame from `image`, so the frame is also sent as `image` while `SEND_LEGACY_IMAGE_FIELD` is `true` in `src/api.ts`. Set it to `false` once the backend reads `frame`. The response's `image` (processed frame) is shown as a "Model output" thumbnail; `detections`, `alert` and `message` are drawn if present.
- `GET /health` drives the "API live / down" indicator.
- `GET /cameras?lat&lon&radius_m&mode` is not on the backend yet; the map stays empty until it exists.

## Android

Works on Android in Expo Go. For installed Android builds, `app.json` allows plain `http://` backend addresses (`usesCleartextTraffic`) and leaves out the microphone permission. Frames are captured with `skipProcessing: false` so they come out upright on every phone.

## Later (from the whiteboard)

Map rerouting, notifications, 3D cone model for AR, video, Ras + multiple data.
