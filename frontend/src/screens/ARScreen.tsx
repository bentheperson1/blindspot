import { CameraView, useCameraPermissions } from "expo-camera";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { useEffect, useRef, useState } from "react";
import {
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
  fetchCameraList,
  fetchNearbyOnScreen,
  lensFromExif,
  sendFrame,
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
import { BORDER, fonts, radii, useThemedStyles, type Palette } from "../theme";
import type { BackendStatus, Detection } from "../types";

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
            const shot = await camRef.current?.takePictureAsync({
              quality: 0.5,
              shutterSound: false,
              skipProcessing: false,
              exif: true,
            });
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
      setOnScreen((prev) =>
        prev.length === 0 && pins.length === 0 ? prev : pins,
      );
    }, MARKER_UPDATE_MS);
    return () => clearInterval(id);
  }, [ready, useLegacyNearby]);

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
              setOnScreen(res.onScreen);
              setInRange(res.inRange);
              setNearbyError(null);
            }
          }
        } catch (e) {
          // Back off after a failure so a slow backend isn't buried under retries.
          waitMs = NEARBY_RETRY_AFTER_FAIL_MS;
          if (!stopped) {
            setOnScreen([]);
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

  // ---- Alert: backend decides via `alert`; if it omits it, any detection counts ----
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
  // Markers come from the cached list (updated 10×/s). The photo upload's dots arrive only every few seconds,
  // so showing them made stale rings freeze on screen; use them only on the old /cameras/nearby fallback.
  const pins = onScreen.length > 0 || !useLegacyNearby ? onScreen : frameDots;
  const alerting = (result.alert ?? detections.length > 0) || pins.length > 0;

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
      : (result.message ??
        (alerting
          ? "A license-plate camera is in frame."
          : "Point the camera at poles and intersections."));

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

      {/* Bottom panel, just above the tab bar */}
      <View style={[styles.bottomCard, { bottom: bottomInset }]}>
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
          <Text style={styles.foot}>Last frame checked in {latencyMs} ms</Text>
        )}
      </View>
    </View>
  );
}

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
    bottomCard: {
      position: "absolute",
      left: 0,
      right: 0,
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
