import { CameraView, useCameraPermissions } from "expo-camera";
import { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, useWindowDimensions, View } from "react-native";
import {
  NoListEndpoint,
  buildNearbyRequest,
  fetchCameraList,
  fetchNearbyOnScreen,
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
  HEADING_SMOOTHING,
  MARKER_UPDATE_MS,
  PHONE_HEIGHT_M,
} from "../config";
import type { Telemetry } from "../sensors";
import { useSettings } from "../settings";
import { BORDER, fonts, useThemedStyles, withAlpha, type Palette } from "../theme";
import type { BackendStatus } from "../types";

const PIN_SMOOTH_MS = 65;
// Fixed at no zoom so the on-screen field of view matches what the projection assumes.
const CAMERA_ZOOM = 0;
// How often to ask /cameras/nearby where cameras are on screen (only on the legacy fallback).
const NEARBY_INTERVAL_MS = 500;
// After a failed network call, wait this long before trying again.
const NEARBY_RETRY_AFTER_FAIL_MS = 10000;

const sleep = (ms: number) =>
  new Promise((r) => setTimeout(r, Math.max(0, ms)));

/** Turns a fetch error into the short line shown on the status card. */
function describeError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/abort|cancel/i.test(msg))
    return "the server isn't reachable from this phone, hasn't finished starting, or is stuck.";
  if (/network request failed|could not connect|offline/i.test(msg))
    return "can't connect to the server address in Settings.";
  return msg;
}

/**
 * AR view: live markers for license-plate cameras around you.
 * It downloads the nearby camera list from the backend and projects each camera onto the
 * screen on the phone (same math as the backend's project_to_screen), ~10×/s. Photo capture
 * and classification live on the Report tab (see ClassifyScreen), not here.
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
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState<BackendStatus>("connecting");

  // Latest settings in a ref so changing them doesn't restart the loop.
  const settingsRef = useRef({ radius_m: radius, mode });
  settingsRef.current = { radius_m: radius, mode };
  const [waitingForSensors, setWaitingForSensors] = useState(false);
  // Cameras /cameras/nearby or the local projection placed on screen.
  const [onScreen, setOnScreen] = useState<ScreenCamera[]>([]);
  // Last nearby/list problem, shown in the status card so it can be debugged on the phone.
  const [nearbyError, setNearbyError] = useState<string | null>(null);
  // How many cameras were found in range on the last call (null = no answer yet).
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

  const pinTargetsRef = useRef<ScreenCamera[]>([]);
  const shownPosRef = useRef<Map<string, { x: number; y: number }>>(new Map());

  const report = (s: BackendStatus) => {
    setStatus(s);
    onBackendStatus(s);
  };

  // ---- Camera list cache: download nearby cameras (lat/long) every 30 s walking / 5 s driving ----
  useEffect(() => {
    if (!ready || useLegacyNearby) return;
    let stopped = false;
    report("connecting");
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
            report("error");
          }
        }
        await sleep(waitMs);
      }
    })();
    return () => {
      stopped = true;
      onBackendStatus("off");
    };
  }, [ready, apiUrl, useLegacyNearby]);

  // ---- Markers: placed on the phone from the cached list ~10×/s (same math as the backend's project_to_screen) ----
  useEffect(() => {
    if (!ready || useLegacyNearby) return;
    const id = setInterval(() => {
      const cached = listRef.current;
      if (!cached) return;
      const { width: w, height: h } = viewRef.current;
      const hfov = screenHfov(null, w, h);
      const t = snapshot();
      const body = buildNearbyRequest(
        t,
        { width: w, height: h, hfov },
        cached.radius,
      );
      setWaitingForSensors((p) => (p === !body ? p : !body));
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
              hfov: screenHfov(null, w, h),
            },
            settingsRef.current.radius_m,
          );
          if (body) {
            const res = await fetchNearbyOnScreen(apiUrl, body);
            if (!stopped) {
              pinTargetsRef.current = res.onScreen;
              setInRange(res.inRange);
              setNearbyError(null);
              report("ok");
            }
          }
        } catch (e) {
          // Back off after a failure so a slow backend isn't buried under retries.
          waitMs = NEARBY_RETRY_AFTER_FAIL_MS;
          if (!stopped) {
            pinTargetsRef.current = [];
            setNearbyError(describeError(e));
            report("error");
          }
        }
        await sleep(waitMs - (Date.now() - started));
      }
    })();
    return () => {
      stopped = true;
    };
  }, [ready, apiUrl, useLegacyNearby]);

  const pins = onScreen;
  const alerting = pins.length > 0;

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
          Hold your phone up and we'll mark any license-plate cameras around you
          right on the live view.
        </Text>
        <Button
          label="Allow camera"
          onPress={requestPermission}
          style={{ alignSelf: "stretch" }}
        />
      </View>
    );
  }

  // What the status strip and bottom text say.
  const offline = status === "error";
  const chip = offline
    ? { label: "Offline", tone: "warning" as const }
    : waitingForSensors
      ? { label: "Waiting", tone: "neutral" as const }
      : alerting
        ? { label: "In view", tone: "alert" as const }
        : { label: "Clear", tone: "success" as const };
  const cardTitle = offline
    ? "No connection"
    : waitingForSensors
      ? "Warming up"
      : alerting
        ? `Camera in view${pins.length > 1 ? ` (${pins.length})` : ""}`
        : "Scanning";
  const headline = offline
    ? "Can't reach the server"
    : waitingForSensors
      ? "Finding your location and direction"
      : alerting
        ? "You're in a camera's view"
        : "No cameras in view";
  const body = offline
    ? `Trying ${apiUrl}. If that isn't the backend's address, fix it in Settings.`
    : waitingForSensors
      ? "Waiting for GPS and the compass. Hold the phone up and move it in a figure-8."
      : alerting
        ? "A license-plate camera is in your line of sight."
        : "Pan around. Markers appear over any cameras near you.";

  return (
    <View style={styles.fill}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        zoom={CAMERA_ZOOM}
        onCameraReady={() => setReady(true)}
        animateShutter={false}
      />

      {/* Cameras projected onto the view: a ring at the exact screen point, with distance. */}
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

      {/* Bottom panel, just above the tab bar */}
      <View style={[styles.bottomCard, { bottom: bottomInset }]}>
        <Text style={styles.headline}>{headline}</Text>
        <Text style={styles.body}>{body}</Text>
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
      backgroundColor: withAlpha(c.alert, 0.18),
    },
    pinLabelWrap: {
      position: "absolute",
      top: PIN + 4,
      left: -40,
      right: -40,
      alignItems: "center",
    },
    fill: { flex: 1, backgroundColor: c.scrim },
    center: {
      alignItems: "center",
      justifyContent: "center",
      padding: 24,
      gap: 12,
      backgroundColor: c.surface,
    },
    permTitle: {
      fontFamily: fonts.heading,
      color: c.onSurface,
      fontSize: 22,
      textAlign: "center",
    },
    permBody: {
      fontFamily: fonts.sans,
      color: c.onSurfaceVariant,
      fontSize: 15,
      lineHeight: 22,
      textAlign: "center",
      maxWidth: 320,
      marginBottom: 8,
    },
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
      color: c.onSurfaceVariant,
    },
    nearbyError: {
      fontFamily: fonts.sans,
      fontSize: 12,
      lineHeight: 16,
      color: c.error,
    },
    infoTitle: { fontFamily: fonts.sansBold, fontSize: 16, color: c.onSurface },
    bottomCard: {
      position: "absolute",
      left: 0,
      right: 0,
      backgroundColor: c.surfaceContainerLow,
      borderTopWidth: BORDER,
      borderTopColor: c.outlineVariant,
      paddingHorizontal: 16,
      paddingTop: 14,
      paddingBottom: 12,
      gap: 8,
    },
    headline: { fontFamily: fonts.heading, fontSize: 18, color: c.onSurface },
    body: {
      fontFamily: fonts.sans,
      fontSize: 14,
      lineHeight: 20,
      color: c.onSurfaceVariant,
    },
  });
