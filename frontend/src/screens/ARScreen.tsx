import { CameraView, useCameraPermissions } from "expo-camera";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import {
  NEARBY_TIMEOUT_MS,
  NoListEndpoint,
  buildNearbyRequest,
  buildPayload,
  classifyPhoto,
  fetchCameraList,
  fetchNearbyOnScreen,
  lensFromExif,
  sendFrame,
  type ClassifyResult,
  type FrameResult,
  type LensInfo,
  type ScreenCamera,
} from "../api";
import {
  projectToScreen,
  yawOffsetDeg,
  type CachedCamera,
} from "../projection";
import { screenHfov } from "../fov";
import { Button, Chip, FramedCard, LogoMark } from "../components/ui";
import { Vignette } from "../components/Vignette";
import { formatDistance } from "../geo";
import { metersBetween } from "../cameraList";
import {
  CAMERA_LIST_MOVE_FRACTION,
  CAMERA_LIST_REFRESH_MS,
  CAMERA_MOUNT_HEIGHT_M,
  FRAME_INTERVAL_MS,
  FRAME_JPEG_QUALITY,
  FRAME_WIDTH_PX,
  HEADING_SMOOTHING,
  MARKER_UPDATE_MS,
  PHONE_HEIGHT_M,
  SEND_FRAMES,
} from "../config";
import type { Telemetry } from "../sensors";
import { useSettings } from "../settings";
import {
  BORDER,
  fonts,
  radii,
  useColors,
  useThemedStyles,
  type Palette,
} from "../theme";
import type { BackendStatus, Detection } from "../types";

/**
 * Snapshot flow: one photo -> POST /classify -> verdict card over the frozen photo.
 * `uri` is null until the photo has been taken and resized.
 */
type Snapshot =
  | { phase: "checking"; uri: string | null }
  | { phase: "result"; uri: string; result: ClassifyResult }
  | { phase: "error"; uri: string | null; message: string };

const VERDICT_UI: Record<
  ClassifyResult["verdict"],
  { chip: string; tone: "alert" | "clear" | "caution"; title: string }
> = {
  camera: { chip: "Detected", tone: "alert", title: "Flock camera detected" },
  not_camera: { chip: "Clear", tone: "clear", title: "Not a Flock camera" },
  unsure_retake: {
    chip: "Unsure",
    tone: "caution",
    title: "Not sure. Try a closer, clearer photo.",
  },
};

const PIN_SMOOTH_MS = 65;
// Fixed at no zoom so the focal length doesn't change under the backend. Sent with every frame in `extra.lens`.
const CAMERA_ZOOM = 0;
// How often to ask /cameras/nearby where cameras are on screen. Only sensor data is sent, so it can run faster than frames.
const NEARBY_INTERVAL_MS = 500;
// After a failed /cameras/nearby call, wait this long before trying again.
const NEARBY_RETRY_AFTER_FAIL_MS = 10000;

const sleep = (ms: number) =>
  new Promise((r) => setTimeout(r, Math.max(0, ms)));

/** Turns a fetch error into the short line shown on the status card. */
function describeError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/abort|cancel/i.test(msg))
    return `no reply in ${NEARBY_TIMEOUT_MS / 1000} s. The server isn't reachable from this phone, hasn't finished starting, or is stuck.`;
  if (/network request failed|could not connect|offline/i.test(msg))
    return "can't connect to the server address in Settings.";
  return msg;
}

/**
 * AR view: a thin client for the backend model.
 * Each tick it sends a base64 frame + raw GPS + raw rotation/motion sensors,
 * and draws exactly what the backend returns. No math or filtering happens here.
 */
export function ARScreen({
  snapshot,
  onBackendStatus,
  topInset,
  bottomInset,
}: {
  snapshot: () => Telemetry;
  onBackendStatus: (s: BackendStatus) => void;
  topInset: number; // space taken by the compass at the top
  bottomInset: number; // height of the tab bar
}) {
  const [permission, requestPermission] = useCameraPermissions();
  const { apiUrl, radius, mode, units } = useSettings();
  const styles = useThemedStyles(makeStyles);
  const { width, height } = useWindowDimensions();
  const camRef = useRef<CameraView>(null);
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState<BackendStatus>("connecting");
  const [result, setResult] = useState<FrameResult>({ detections: [] });
  const detections: Detection[] = result.detections;

  // Latest settings in a ref so changing them doesn't restart the loop.
  const settingsRef = useRef({ radius_m: radius, mode });
  settingsRef.current = { radius_m: radius, mode };
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [showOutputFull, setShowOutputFull] = useState(false);
  const [waitingForSensors, setWaitingForSensors] = useState(false);
  // Latest lens info from frame EXIF (for hfov), and the cameras /cameras/nearby placed on screen.
  const lensRef = useRef<LensInfo | null>(null);
  const [onScreen, setOnScreen] = useState<ScreenCamera[]>([]);
  // Last /cameras/nearby problem, shown in the status card so it can be debugged on the phone.
  const [nearbyError, setNearbyError] = useState<string | null>(null);
  // How many cameras /cameras/nearby found in range on the last call (null = no answer yet).
  const [inRange, setInRange] = useState<number | null>(null);
  // Cached camera list from /cameras/list (refreshed every 30 s walking / 5 s driving) and where it was fetched.
  const listRef = useRef<{
    cams: CachedCamera[];
    at: number;
    lat: number;
    lon: number;
    radius: number;
  } | null>(null);
  // True if the backend has no /cameras/list yet: then fall back to asking /cameras/nearby every 0.5 s.
  const [useLegacyNearby, setUseLegacyNearby] = useState(false);
  const modeRef = useRef(mode);
  modeRef.current = mode;
  // When the camera list last downloaded fine. While it's recent, a failed photo upload doesn't mean "offline".
  const lastListOkRef = useRef(0);
  // Smoothed gyro-to-north offset (degrees). null until the first reading.
  const yawOffsetRef = useRef<number | null>(null);
  // Compass calibration level 0–3 (expo-location). Low = markers can be off by a lot until it's calibrated.
  const [compassLevel, setCompassLevel] = useState<number | null>(null);
  // GPS smoothed over a few seconds (indoors a fix can jump 20–50 m between readings).
  const smoothPosRef = useRef<{
    lat: number;
    lon: number;
    ts: number | null;
  } | null>(null);
  // Displayed distance per camera, eased so the label doesn't jump around.
  const shownDistRef = useRef<Map<number, number>>(new Map());
  const viewRef = useRef({ width, height });
  viewRef.current = { width, height };
  const c = useColors();

  // Snapshot state. While a snapshot is being taken or its card is open, the frame loop is paused
  // (pausedRef), and the snapshot waits for any frame capture already in flight (captureRef) so the
  // two never call takePictureAsync at the same time.
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const pausedRef = useRef(false);
  const captureRef = useRef<Promise<unknown> | null>(null);

  const pinTargetsRef = useRef<ScreenCamera[]>([]);
  const shownPosRef = useRef<Map<string, { x: number; y: number }>>(new Map());

  const report = (s: BackendStatus) => {
    setStatus(s);
    onBackendStatus(s);
  };

  // ---- Frame loop: capture -> shrink -> model -> draw (slow on purpose: each photo stalls the preview) ----
  useEffect(() => {
    if (!ready || !SEND_FRAMES) return;
    let stopped = false;
    report("connecting");

    (async () => {
      while (!stopped) {
        if (pausedRef.current) {
          await new Promise((r) => setTimeout(r, 250));
          continue;
        }
        const started = Date.now();
        try {
          // Sensor readings and timestamps are all taken at the moment of capture, so they line up with the frame.
          const telemetry = snapshot();
          const monotonicMs = performance.now();
          const timestampSec = Date.now() / 1000;
          // Don't spend a capture until GPS, compass and motion all have a reading.
          if (
            !buildPayload(
              telemetry,
              null,
              { timestampSec, monotonicMs },
              { platform: Platform.OS, settings: settingsRef.current },
            )
          ) {
            if (!stopped) setWaitingForSensors(true);
          } else {
            if (!stopped) setWaitingForSensors(false);
            // skipProcessing must stay off: with it on, many Android phones return sideways frames.
            // exif: true returns this photo's focal length; the resize below strips EXIF, so it's sent as `extra.lens`.
            const capture = camRef.current?.takePictureAsync({
              quality: 0.5,
              shutterSound: false,
              skipProcessing: false,
              exif: true,
            });
            captureRef.current = capture ?? null;
            const shot = await capture;
            if (shot && !stopped) {
              const img = await ImageManipulator.manipulate(shot.uri)
                .resize({ width: FRAME_WIDTH_PX })
                .renderAsync();
              const small = await img.saveAsync({
                compress: FRAME_JPEG_QUALITY,
                format: SaveFormat.JPEG,
                base64: true,
              });
              const lens = lensFromExif(shot.exif, CAMERA_ZOOM);
              lensRef.current = lens;
              const payload = buildPayload(
                telemetry,
                {
                  base64: small.base64 ?? "",
                  width: small.width,
                  height: small.height,
                  cameraWidth: shot.width,
                  cameraHeight: shot.height,
                  lens,
                },
                { timestampSec, monotonicMs },
                { platform: Platform.OS, settings: settingsRef.current },
              );
              if (payload) {
                const res = await sendFrame(apiUrl, payload);
                if (!stopped) {
                  setResult(res);
                  setLatencyMs(Date.now() - started);
                  report("ok");
                }
              }
            }
          }
        } catch {
          if (!stopped) {
            setResult({ detections: [] });
            // Only show "No connection" if the camera list isn't getting through either.
            if (
              Date.now() - lastListOkRef.current >
              CAMERA_LIST_REFRESH_MS.pedestrian + 10_000
            )
              report("error");
          }
        }
        const wait = Math.max(0, FRAME_INTERVAL_MS - (Date.now() - started));
        await new Promise((r) => setTimeout(r, wait));
      }
    })();

    return () => {
      stopped = true;
      onBackendStatus("off");
    };
  }, [ready, apiUrl]);

  // ---- Camera list cache: download nearby cameras (lat/long) every 30 s walking / 5 s driving ----
  useEffect(() => {
    if (!ready || useLegacyNearby) return;
    let stopped = false;
    (async () => {
      while (!stopped) {
        let waitMs = 1000; // check once a second whether a re-download is due (cheap, no network)
        try {
          const loc = snapshot().location;
          const radius_m = settingsRef.current.radius_m;
          if (loc) {
            const cached = listRef.current;
            const due =
              !cached ||
              cached.radius !== radius_m ||
              Date.now() - cached.at >
                CAMERA_LIST_REFRESH_MS[modeRef.current] ||
              metersBetween(
                cached.lat,
                cached.lon,
                loc.latitude,
                loc.longitude,
              ) >
                radius_m * CAMERA_LIST_MOVE_FRACTION;
            if (due) {
              const cams = await fetchCameraList(
                apiUrl,
                loc.latitude,
                loc.longitude,
                radius_m,
              );
              if (stopped) break;
              listRef.current = {
                cams,
                at: Date.now(),
                lat: loc.latitude,
                lon: loc.longitude,
                radius: radius_m,
              };
              shownDistRef.current = new Map(); // list order may change, so eased labels start fresh
              setInRange(cams.length);
              setNearbyError(null);
              lastListOkRef.current = Date.now();
              report("ok");
            }
          }
        } catch (e) {
          if (e instanceof NoListEndpoint) {
            if (!stopped) setUseLegacyNearby(true); // older backend: use /cameras/nearby instead
            return;
          }
          waitMs = NEARBY_RETRY_AFTER_FAIL_MS;
          if (!stopped) {
            setNearbyError(describeError(e));
            if (!SEND_FRAMES) report("error");
          }
        }
        await sleep(waitMs);
      }
    })();
    return () => {
      stopped = true;
    };
  }, [ready, apiUrl, useLegacyNearby]);

  // ---- Markers: placed on the phone from the cached list ~10×/s (same math as the backend's project_to_screen) ----
  useEffect(() => {
    if (!ready || useLegacyNearby) return;
    const id = setInterval(() => {
      const cached = listRef.current;
      if (!cached) return;
      const { width: w, height: h } = viewRef.current;
      const hfov = screenHfov(lensRef.current?.focal_length_35mm, w, h);
      const t = snapshot();
      const body = buildNearbyRequest(
        t,
        { width: w, height: h, hfov },
        cached.radius,
      );
      if (!body) return;

      // Smooth GPS: blend each new fix in, trusting accurate fixes more than poor ones.
      const loc = t.location;
      const sp = smoothPosRef.current;
      if (loc && (!sp || sp.ts !== t.locationTimestamp)) {
        const acc = loc.accuracy ?? 30;
        const k = !sp ? 1 : acc <= 10 ? 0.5 : acc <= 25 ? 0.25 : 0.1;
        smoothPosRef.current = {
          lat: !sp ? loc.latitude : sp.lat + k * (loc.latitude - sp.lat),
          lon: !sp ? loc.longitude : sp.lon + k * (loc.longitude - sp.lon),
          ts: t.locationTimestamp,
        };
      }
      const me = smoothPosRef.current ?? { lat: body.lat_p, lon: body.lon_p };

      // Steadier heading: the gyro (alpha) handles quick turns; the compass only nudges the offset to north.
      const raw = yawOffsetDeg(
        body.alpha,
        body.beta,
        body.gamma,
        body.compass_heading,
      );
      const prev = yawOffsetRef.current;
      const gap =
        prev == null ? 0 : ((((raw - prev + 180) % 360) + 360) % 360) - 180; // shortest way around
      // Correct faster when the gap is big (first fix, gyro drift), gently when it's just compass noise.
      const k = prev == null ? 1 : Math.abs(gap) > 25 ? 0.5 : HEADING_SMOOTHING;
      const offset = prev == null ? raw : prev + k * gap;
      yawOffsetRef.current = offset;
      const level = t.compass ? Math.round(t.compass.accuracy) : null;
      setCompassLevel((p) => (p === level ? p : level));

      const pins: ScreenCamera[] = projectToScreen(
        me.lat,
        me.lon,
        body.alpha,
        body.beta,
        body.gamma,
        body.compass_heading,
        cached.cams,
        w,
        h,
        hfov,
        {
          yawOffsetDeg: offset,
          phoneAltM: PHONE_HEIGHT_M,
          cameraAltM: CAMERA_MOUNT_HEIGHT_M,
        },
      )
        .filter((p) => p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1)
        .map((p) => {
          // Label = real distance along the ground (not depth along the camera's view, which changes as you turn),
          // eased toward the new value so it settles instead of jumping.
          const cam = cached.cams[p.index];
          const d = metersBetween(me.lat, me.lon, cam.latitude, cam.longitude);
          const prevD = shownDistRef.current.get(p.index);
          const shown = prevD == null ? d : prevD + 0.15 * (d - prevD);
          shownDistRef.current.set(p.index, shown);
          return {
            key: `${p.name}-${p.index}`,
            x: p.x * w,
            y: p.y * h,
            label: p.name,
            distance_m: shown,
          };
        });
      pinTargetsRef.current = pins;
    }, MARKER_UPDATE_MS);
    return () => clearInterval(id);
  }, [ready, useLegacyNearby]);

  // ---- Smoothing: ease drawn marker positions toward their targets every frame ----
  useEffect(() => {
    if (!ready) return;
    let raf = 0;
    let last = performance.now();

    const tick = (now: number) => {
      const dt = Math.min(now - last, 100);
      last = now;
      const k = 1 - Math.exp(-dt / PIN_SMOOTH_MS);

      const targets = pinTargetsRef.current;
      const shown = shownPosRef.current;

      const next = targets.map((p) => {
        const prev = shown.get(p.key);
        // A marker that just appeared starts at its target instead of flying in from nowhere.
        const x = prev ? prev.x + k * (p.x - prev.x) : p.x;
        const y = prev ? prev.y + k * (p.y - prev.y) : p.y;
        shown.set(p.key, { x, y });
        return { ...p, x, y };
      });

      // Forget markers that left the screen so they start fresh if they come back.
      if (shown.size > targets.length) {
        const keys = new Set(targets.map((p) => p.key));
        for (const key of shown.keys()) {
          if (!keys.has(key)) shown.delete(key);
        }
      }

      setOnScreen((prev) => (prev.length === 0 && next.length === 0 ? prev : next));
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [ready]);

  // ---- Fallback (only if the backend has no /cameras/list): ask /cameras/nearby every 0.5 s ----
  useEffect(() => {
    if (!ready || !useLegacyNearby) return;
    let stopped = false;
    (async () => {
      while (!stopped) {
        const started = Date.now();
        let waitMs = NEARBY_INTERVAL_MS;
        try {
          const { width: w, height: h } = viewRef.current;
          const body = buildNearbyRequest(
            snapshot(),
            {
              width: w,
              height: h,
              hfov: screenHfov(lensRef.current?.focal_length_35mm, w, h),
            },
            settingsRef.current.radius_m,
          );
          if (body) {
            const res = await fetchNearbyOnScreen(apiUrl, body);
            if (!stopped) {
              if (!stopped) {
                pinTargetsRef.current = res.onScreen;
                setInRange(res.inRange);
                setNearbyError(null);
              }

              setInRange(res.inRange);
              setNearbyError(null);
            }
          }
        } catch (e) {
          // Back off after a failure so a slow backend isn't buried under retries.
          waitMs = NEARBY_RETRY_AFTER_FAIL_MS;
          if (!stopped) {
            if (!stopped) {
              pinTargetsRef.current = [];
              setNearbyError(describeError(e));
            }

            setNearbyError(describeError(e));
          }
        }
        await sleep(waitMs - (Date.now() - started));
      }
    })();
    return () => {
      stopped = true;
    };
  }, [ready, apiUrl, useLegacyNearby]);

  // ---- Snapshot: one photo -> /classify -> verdict card ----
  const takeSnapshot = async () => {
    if (snap || !ready) return;
    pausedRef.current = true;
    setSnap({ phase: "checking", uri: null });
    let uri: string;
    let base64: string;
    try {
      await captureRef.current?.catch(() => {});
      const shot = await camRef.current?.takePictureAsync({
        quality: 0.5,
        skipProcessing: false,
      });
      if (!shot) throw new Error("no photo");
      const img = await ImageManipulator.manipulate(shot.uri)
        .resize({ width: FRAME_WIDTH_PX })
        .renderAsync();
      const photo = await img.saveAsync({
        compress: FRAME_JPEG_QUALITY,
        format: SaveFormat.JPEG,
        base64: true,
      });
      if (!photo.base64) throw new Error("no base64");
      uri = photo.uri;
      base64 = photo.base64;
    } catch {
      setSnap({
        phase: "error",
        uri: null,
        message: "Couldn't take the photo. Try again.",
      });
      return;
    }
    setSnap({ phase: "checking", uri });
    try {
      setSnap({
        phase: "result",
        uri,
        result: await classifyPhoto(apiUrl, base64),
      });
    } catch (e) {
      const detail = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      console.log("[snapshot] /classify failed", `${apiUrl}/classify-base64`, detail);
      setSnap({
        phase: "error",
        uri,
        message: `Couldn't reach the detector (${detail}) at ${apiUrl}/classify-base64`,
      });
    }
  };

  const dismissSnapshot = () => {
    setSnap(null);
    pausedRef.current = false;
  };

  // ---- Alert: a camera is in view when the backend places one on screen ----
  // The frame loop no longer carries the classifier's verdict; that's the snapshot card's job.
  // Cameras the frame endpoint placed (dots, 0–1 in the camera view), drawn the same way as /cameras/nearby ones.
  const frameDots: ScreenCamera[] = (result.dots ?? [])
    .filter((d) => d.x >= 0 && d.x <= 1 && d.y >= 0 && d.y <= 1)
    .map((d, i) => ({
      key: `dot-${d.name}-${i}`,
      x: d.x * width,
      y: d.y * height,
      label: d.name,
      distance_m: d.distance_to_user,
    }));
  const pins = onScreen.length > 0 ? onScreen : frameDots;
  const alerting = detections.length > 0 || pins.length > 0;

  if (!permission) return <View style={styles.fill} />;
  if (!permission.granted) {
    return (
      <View
        style={[
          styles.fill,
          styles.center,
          { paddingBottom: bottomInset + 28 },
        ]}
      >
        <LogoMark size={96} />
        <Text style={styles.permTitle} accessibilityRole="header">
          Camera access needed
        </Text>
        <Text style={styles.permBody}>
          Point your camera at poles and intersections. Each frame is checked
          for license-plate cameras.
        </Text>
        <Button
          label="Allow camera"
          onPress={requestPermission}
          style={{ alignSelf: "stretch" }}
        />
      </View>
    );
  }

  // What the status strip and bottom text say, from the backend's answer.
  const offline = status === "error";
  const chip = offline
    ? { label: "Offline", tone: "surface" as const }
    : waitingForSensors
      ? { label: "Waiting", tone: "surface" as const }
      : alerting
        ? { label: "In view", tone: "alert" as const }
        : { label: "Clear", tone: "surface" as const };
  const cardTitle = offline
    ? "No connection"
    : waitingForSensors
      ? "Warming up"
      : alerting
        ? `Camera spotted${Math.max(detections.length, pins.length) > 1 ? ` (${Math.max(detections.length, pins.length)})` : ""}`
        : "Scanning";
  const headline = offline
    ? "Can't reach the server"
    : waitingForSensors
      ? "Finding your location and direction"
      : alerting
        ? "You're in a camera's view"
        : "No cameras detected";
  const body = offline
    ? `Trying ${apiUrl}. If that isn't the backend's address, fix it in Settings.`
    : waitingForSensors
      ? "Waiting for GPS and the compass. Hold the phone up and move it in a figure-8."
      : alerting
        ? "A license-plate camera is in frame."
        : "Point at a pole-mounted camera and tap the shutter to check it.";

  return (
    <View style={styles.fill}>
      <CameraView
        ref={camRef}
        style={StyleSheet.absoluteFill}
        facing="back"
        zoom={CAMERA_ZOOM}
        onCameraReady={() => setReady(true)}
        animateShutter={false}
      />

      {/* Model detections. Boxes are normalized 0–1 relative to the frame. */}
      {detections.map((d, i) => (
        <View
          key={i}
          pointerEvents="none"
          style={[
            styles.detBox,
            {
              left: d.box[0] * width,
              top: d.box[1] * height,
              width: d.box[2] * width,
              height: d.box[3] * height,
            },
          ]}
        >
          <View style={styles.detLabelWrap}>
            <Chip
              label={`${d.label} ${Math.round(d.confidence * 100)}%`}
              tone="alert"
            />
          </View>
        </View>
      ))}

      {/* Cameras placed by /cameras/nearby: a ring at the exact screen point, with name and distance. */}
      {pins.map((cam) => (
        <View
          key={cam.key}
          pointerEvents="none"
          style={[styles.pin, { left: cam.x - PIN / 2, top: cam.y - PIN / 2 }]}
        >
          <View style={styles.pinRing} />
          <View style={styles.pinLabelWrap}>
            <Chip
              label={
                cam.distance_m != null
                  ? formatDistance(cam.distance_m, units)
                  : "—"
              }
              tone="alert"
            />
          </View>
        </View>
      ))}

      {/* Red edge glow: fades in when a camera comes into view, breathes while it stays, fades out when it leaves. */}
      <Vignette active={alerting} />

      {/* Status, top left */}
      <FramedCard style={[styles.infoCard, { top: topInset - 40 }]}>
        <Chip label={chip.label} tone={chip.tone} />
        <Text style={styles.infoTitle}>{cardTitle}</Text>
        {compassLevel != null && compassLevel <= 1 && !nearbyError ? (
          <Text style={styles.nearbyError}>
            Compass needs calibrating: move the phone in a figure‑8 for markers
            to line up.
          </Text>
        ) : null}
        {nearbyError ? (
          <Text style={styles.nearbyError}>Nearby: {nearbyError}</Text>
        ) : inRange != null ? (
          <Text style={styles.nearbyInfo}>
            {inRange === 0
              ? `No cameras within ${(radius / 1609.344).toFixed(1)} mi`
              : `${inRange} camera${inRange === 1 ? "" : "s"} within ${(radius / 1609.344).toFixed(1)} mi · ${onScreen.length} on screen`}
          </Text>
        ) : null}
      </FramedCard>

      {/* Processed frame from the backend. Tap to toggle full screen. */}
      {result.image ? (
        <Pressable
          onPress={() => setShowOutputFull((v) => !v)}
          style={
            showOutputFull
              ? StyleSheet.absoluteFill
              : [styles.outputThumb, { top: topInset + 12 }]
          }
          accessibilityRole="button"
          accessibilityLabel={
            showOutputFull
              ? "Close model output"
              : "Show model output full screen"
          }
        >
          <Image
            source={{ uri: `data:image/jpeg;base64,${result.image}` }}
            style={StyleSheet.absoluteFill}
            resizeMode="cover"
          />
          {!showOutputFull && (
            <Text style={styles.outputLabel}>Model output</Text>
          )}
        </Pressable>
      ) : null}

      {/* Shutter + bottom panel, just above the tab bar */}
      <View style={[styles.bottomDock, { bottom: bottomInset }]}>
        <View style={styles.shutterRow}>
          <Pressable
            onPress={takeSnapshot}
            disabled={!ready || snap != null}
            accessibilityRole="button"
            accessibilityLabel="Take a photo and check it for a Flock camera"
            accessibilityState={{ disabled: !ready || snap != null }}
            hitSlop={8}
            style={({ pressed }) => [
              styles.shutter,
              (pressed || !ready) && { opacity: 0.6 },
            ]}
          >
            <View style={styles.shutterInner} />
          </Pressable>
        </View>
        <View style={styles.bottomCard}>
          <Text style={styles.headline}>{headline}</Text>
          <Text style={styles.body}>{body}</Text>
          {result.image ? (
            <Button
              label={showOutputFull ? "Show camera" : "Show model output"}
              variant="secondary"
              onPress={() => setShowOutputFull((v) => !v)}
            />
          ) : null}
          {latencyMs != null && status === "ok" && (
            <Text style={styles.foot}>
              Last frame checked in {latencyMs} ms
            </Text>
          )}
        </View>
      </View>

      {/* Snapshot: the frozen photo with the verdict card on top. Covers the live view and its pins. */}
      {snap && (
        <View style={[StyleSheet.absoluteFill, styles.snapBackdrop]}>
          {snap.uri && (
            <Image
              source={{ uri: snap.uri }}
              style={StyleSheet.absoluteFill}
              resizeMode="cover"
              accessibilityLabel="The photo you took"
            />
          )}
          {snap.phase === "result" && (
            <View
              pointerEvents="none"
              style={[
                StyleSheet.absoluteFill,
                styles.snapBorder,
                { borderColor: c[VERDICT_UI[snap.result.verdict].tone] },
              ]}
            />
          )}
          <FramedCard style={[styles.snapCard, { bottom: bottomInset + 16 }]}>
            {snap.phase === "checking" && (
              <View
                style={styles.snapChecking}
                accessibilityLiveRegion="polite"
              >
                <ActivityIndicator color={c.ink} />
                <Text style={styles.snapTitle}>Checking…</Text>
              </View>
            )}
            {snap.phase === "result" && (
              <View accessibilityLiveRegion="polite" style={styles.snapBody}>
                <Chip
                  label={VERDICT_UI[snap.result.verdict].chip}
                  tone={VERDICT_UI[snap.result.verdict].tone}
                />
                <Text
                  style={[
                    styles.snapTitle,
                    snap.result.verdict === "camera" && { color: c.alert },
                  ]}
                >
                  {VERDICT_UI[snap.result.verdict].title}
                </Text>
                {snap.result.verdict === "camera" && (
                  <Text style={styles.snapProb}>
                    {Math.round(snap.result.camera_probability * 100)}%
                    confidence
                  </Text>
                )}
                <Text style={styles.foot}>
                  {Math.round(snap.result.latency_ms)} ms · Analyzed on IBM
                  LinuxONE
                </Text>
              </View>
            )}
            {snap.phase === "error" && (
              <View accessibilityLiveRegion="polite" style={styles.snapBody}>
                <Chip label="Error" tone="surface" />
                <Text style={styles.snapTitle}>{snap.message}</Text>
              </View>
            )}
            {snap.phase !== "checking" && (
              <Button
                label="Take another"
                icon="camera"
                onPress={dismissSnapshot}
              />
            )}
          </FramedCard>
        </View>
      )}
    </View>
  );
}

const SHUTTER = 76;

const PIN = 44;

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    pin: {
      position: "absolute",
      width: PIN,
      height: PIN,
      alignItems: "center",
    },
    pinRing: {
      width: PIN,
      height: PIN,
      borderRadius: PIN / 2,
      borderWidth: 4,
      borderColor: c.alert,
      backgroundColor: "rgba(183,25,71,0.18)",
    },
    pinLabelWrap: {
      position: "absolute",
      top: PIN + 4,
      left: -40,
      right: -40,
      alignItems: "center",
    },
    fill: { flex: 1, backgroundColor: "#282B4A" },
    center: {
      alignItems: "center",
      justifyContent: "center",
      padding: 24,
      gap: 12,
      backgroundColor: c.paper,
    },
    permTitle: {
      fontFamily: fonts.heading,
      color: c.ink,
      fontSize: 22,
      textAlign: "center",
    },
    permBody: {
      fontFamily: fonts.sans,
      color: c.muted,
      fontSize: 15,
      lineHeight: 22,
      textAlign: "center",
      maxWidth: 320,
      marginBottom: 8,
    },
    detBox: {
      position: "absolute",
      borderWidth: 3,
      borderColor: c.alert,
      borderRadius: 4,
    },
    detLabelWrap: { position: "absolute", top: -30, left: -3 },
    infoCard: {
      position: "absolute",
      left: 16,
      paddingHorizontal: 12,
      paddingVertical: 10,
      gap: 6,
      maxWidth: 250,
    },
    nearbyInfo: {
      fontFamily: fonts.sans,
      fontSize: 12,
      lineHeight: 16,
      color: c.muted,
    },
    nearbyError: {
      fontFamily: fonts.sans,
      fontSize: 12,
      lineHeight: 16,
      color: c.alert,
    },
    infoTitle: { fontFamily: fonts.sansBold, fontSize: 16, color: c.ink },
    outputThumb: {
      position: "absolute",
      right: 16,
      width: 108,
      height: 144,
      borderRadius: radii.tile,
      overflow: "hidden",
      borderWidth: BORDER,
      borderColor: c.outline,
      backgroundColor: c.paper,
    },
    outputLabel: {
      position: "absolute",
      bottom: 0,
      left: 0,
      right: 0,
      textAlign: "center",
      backgroundColor: c.surface,
      color: c.ink,
      fontSize: 11,
      fontFamily: fonts.sansBold,
      paddingVertical: 4,
    },
    bottomDock: { position: "absolute", left: 0, right: 0 },
    shutterRow: { alignItems: "center", paddingBottom: 14 },
    shutter: {
      width: SHUTTER,
      height: SHUTTER,
      borderRadius: SHUTTER / 2,
      borderWidth: 4,
      borderColor: c.paper,
      backgroundColor: "rgba(40,43,74,0.35)",
      alignItems: "center",
      justifyContent: "center",
    },
    shutterInner: {
      width: SHUTTER - 18,
      height: SHUTTER - 18,
      borderRadius: (SHUTTER - 18) / 2,
      backgroundColor: c.paper,
      borderWidth: BORDER,
      borderColor: c.outline,
    },
    snapBackdrop: { backgroundColor: "#282B4A" },
    snapBorder: { borderWidth: 8 },
    snapCard: {
      position: "absolute",
      left: 16,
      right: 16,
      padding: 16,
      gap: 14,
    },
    snapBody: { gap: 8 },
    snapChecking: { flexDirection: "row", alignItems: "center", gap: 10 },
    snapTitle: { fontFamily: fonts.heading, fontSize: 20, color: c.ink },
    snapProb: { fontFamily: fonts.sansBold, fontSize: 16, color: c.ink },
    bottomCard: {
      backgroundColor: c.paper,
      borderTopWidth: BORDER,
      borderTopColor: c.outline,
      paddingHorizontal: 16,
      paddingTop: 14,
      paddingBottom: 12,
      gap: 8,
    },
    headline: { fontFamily: fonts.heading, fontSize: 18, color: c.ink },
    body: {
      fontFamily: fonts.sans,
      fontSize: 14,
      lineHeight: 20,
      color: c.muted,
    },
    foot: { fontFamily: fonts.sans, fontSize: 12, color: c.muted },
  });
