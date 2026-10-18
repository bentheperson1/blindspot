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
  buildNearbyRequest,
  buildPayload,
  classifyPhoto,
  fetchNearbyOnScreen,
  lensFromExif,
  sendFrame,
  type ClassifyResult,
  type FrameResult,
  type LensInfo,
  type ScreenCamera,
} from "../api";
import { screenHfov } from "../fov";
import { Button, Chip, FramedCard, LogoMark } from "../components/ui";
import {
  FRAME_INTERVAL_MS,
  FRAME_JPEG_QUALITY,
  FRAME_WIDTH_PX,
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

// Fixed at no zoom so the focal length doesn't change under the backend. Sent with every frame in `extra.lens`.
const CAMERA_ZOOM = 0;
// How often to ask /cameras/nearby where cameras are on screen. Only sensor data is sent, so it can run faster than frames.
const NEARBY_INTERVAL_MS = 500;
const NEARBY_RETRY_AFTER_FAIL_MS = 10000;

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
  const { apiUrl, radius, mode } = useSettings();
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
  const viewRef = useRef({ width, height });
  viewRef.current = { width, height };
  const c = useColors();

  // Snapshot state. While a snapshot is being taken or its card is open, the frame loop is paused
  // (pausedRef), and the snapshot waits for any frame capture already in flight (captureRef) so the
  // two never call takePictureAsync at the same time.
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const pausedRef = useRef(false);
  const captureRef = useRef<Promise<unknown> | null>(null);

  const report = (s: BackendStatus) => {
    setStatus(s);
    onBackendStatus(s);
  };

  // ---- Frame loop: capture -> shrink -> model -> draw ----
  useEffect(() => {
    if (!ready) return;
    let stopped = false;
    report("connecting");

    (async () => {
      while (!stopped) {
        if (pausedRef.current) {
          await new Promise((r) => setTimeout(r, 250));
          continue;
        }
        const started = Date.now();
        let waitMs = NEARBY_INTERVAL_MS;
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
          waitMs = NEARBY_RETRY_AFTER_FAIL_MS;
          if (!stopped) {
            setResult({ detections: [] });
            report("error");
          }
        }
        const wait = Math.max(0, FRAME_INTERVAL_MS - (Date.now() - started));
        await new Promise((r) =>
          setTimeout(r, Math.max(0, waitMs - (Date.now() - started))),
        );
      }
    })();

    return () => {
      stopped = true;
      onBackendStatus("off");
    };
  }, [ready, apiUrl]);

  // ---- Nearby loop: POST /cameras/nearby -> markers at the screen position the backend returns ----
  useEffect(() => {
    if (!ready) return;
    let stopped = false;
    (async () => {
      while (!stopped) {
        const started = Date.now();
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
            const cams = await fetchNearbyOnScreen(apiUrl, body);
            if (!stopped) {
              setOnScreen(cams);
              setNearbyError(null);
            }
          }
        } catch (e) {
          if (!stopped) {
            setOnScreen([]);
            const msg = e instanceof Error ? e.message : String(e);
            setNearbyError(
              /abort|cancel/i.test(msg)
                ? `no reply in ${NEARBY_TIMEOUT_MS / 1000} s. The server is reachable but /cameras/nearby is too slow or stuck.`
                : /network request failed|could not connect|offline/i.test(msg)
                  ? "can't connect to the server address in Settings."
                  : msg,
            );
          }
        }
        await new Promise((r) =>
          setTimeout(
            r,
            Math.max(0, NEARBY_INTERVAL_MS - (Date.now() - started)),
          ),
        );
      }
    })();
    return () => {
      stopped = true;
    };
  }, [ready, apiUrl]);

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
    ? "Check the server address in Settings. Frames start sending again on their own."
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
                  ? `${cam.label} · ${Math.round(cam.distance_m)} m`
                  : cam.label
              }
              tone="alert"
            />
          </View>
        </View>
      ))}

      {/* Solid border while a camera is in view (no animation). */}
      {alerting && (
        <View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, styles.alertBorder]}
        />
      )}

      {/* Status, top left */}
      <FramedCard style={[styles.infoCard, { top: topInset - 40 }]}>
        <Chip label={chip.label} tone={chip.tone} />
        <Text style={styles.infoTitle}>{cardTitle}</Text>
        {nearbyError && (
          <Text style={styles.nearbyError}>Nearby: {nearbyError}</Text>
        )}
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
      alignItems: "center",
      minWidth: 160,
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
    alertBorder: { borderWidth: 8, borderColor: c.alert },
    infoCard: {
      position: "absolute",
      left: 16,
      paddingHorizontal: 12,
      paddingVertical: 10,
      gap: 6,
      maxWidth: 250,
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
