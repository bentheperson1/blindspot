import { CameraView, useCameraPermissions } from "expo-camera";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { classifyPhoto, type ClassifyResult } from "../api";
import { Button, Chip, FramedCard, LogoMark } from "../components/ui";
import { FRAME_JPEG_QUALITY, FRAME_WIDTH_PX } from "../config";
import type { Telemetry } from "../sensors";
import { useSettings } from "../settings";
import { BORDER, fonts, useColors, useThemedStyles, type Palette } from "../theme";

type Phase = "idle" | "processing" | "done" | "error";

// No zoom, so the photo frames the camera the way the user sees it.
const CAMERA_ZOOM = 0;

/** Turns a fetch/capture error into a short readable line. */
function describeError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/abort|cancel|timeout/i.test(msg))
    return "The server didn't answer in time. Check it's running and reachable in Settings.";
  if (/network request failed|could not connect|offline/i.test(msg))
    return "Can't reach the server address set in Settings.";
  return msg;
}

/**
 * Report tab: the user takes one photo of a suspected camera. The photo and their GPS location
 * are sent to the backend, where a model decides whether it's actually a Flock camera. The screen
 * shows that verdict. (Finding cameras already around you is the Camera tab's job, not this one.)
 */
export function ClassifyScreen({
  snapshot,
  topInset,
  bottomInset,
}: {
  snapshot: () => Telemetry;
  topInset: number;
  bottomInset: number;
}) {
  const [permission, requestPermission] = useCameraPermissions();
  const { apiUrl } = useSettings();
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);
  const camRef = useRef<CameraView>(null);

  const [phase, setPhase] = useState<Phase>("idle");
  const [shotUri, setShotUri] = useState<string | null>(null);
  const [coords, setCoords] = useState<{ lat: number; lon: number } | null>(null);
  const [result, setResult] = useState<ClassifyResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setPhase("idle");
    setShotUri(null);
    setCoords(null);
    setResult(null);
    setError(null);
  };

  const capture = async () => {
    const cam = camRef.current;
    if (!cam || phase === "processing") return;
    setPhase("processing");
    setError(null);
    setResult(null);
    try {
      // The reporter's GPS at the moment of capture goes up with the photo.
      const loc = snapshot().location;
      setCoords(loc ? { lat: loc.latitude, lon: loc.longitude } : null);

      const shot = await cam.takePictureAsync({
        quality: 0.6,
        shutterSound: false,
        skipProcessing: false,
      });
      if (!shot) throw new Error("Couldn't capture a photo. Try again.");
      setShotUri(shot.uri);

      // Shrink before upload so the request is small and quick.
      const img = await ImageManipulator.manipulate(shot.uri)
        .resize({ width: FRAME_WIDTH_PX })
        .renderAsync();
      const small = await img.saveAsync({
        compress: FRAME_JPEG_QUALITY,
        format: SaveFormat.JPEG,
        base64: true,
      });

      const res = await classifyPhoto(apiUrl, small.base64 ?? "");
      setResult(res);
      setPhase("done");
    } catch (e) {
      setError(describeError(e));
      setPhase("error");
    }
  };

  if (!permission) return <View style={styles.fill} />;
  if (!permission.granted) {
    return (
      <View style={[styles.fill, styles.center, { paddingBottom: bottomInset + 28 }]}>
        <LogoMark size={96} />
        <Text style={styles.permTitle} accessibilityRole="header">
          Camera access needed
        </Text>
        <Text style={styles.permBody}>
          Take a photo of a camera you spot and we'll check if it's a Flock camera.
        </Text>
        <Button
          label="Allow camera"
          onPress={requestPermission}
          style={{ alignSelf: "stretch" }}
        />
      </View>
    );
  }

  const showPreview = phase !== "idle" && shotUri;
  const verdict = result?.verdict ?? null;
  const isFlock = verdict === "camera";
  const unsure = verdict === "unsure_retake";

  return (
    <View style={styles.fill}>
      {/* Live camera until a shot is taken; then the captured photo while we process/show the verdict. */}
      {showPreview ? (
        <Image
          source={{ uri: shotUri! }}
          style={StyleSheet.absoluteFill}
          resizeMode="cover"
        />
      ) : (
        <CameraView
          ref={camRef}
          style={StyleSheet.absoluteFill}
          facing="back"
          zoom={CAMERA_ZOOM}
          animateShutter={false}
        />
      )}

      {/* Dim the photo while the request is in flight. */}
      {phase === "processing" && (
        <View style={styles.processing} pointerEvents="none">
          <ActivityIndicator size="large" color={colors.onAlert} />
          <Text style={styles.processingText}>Checking with the server…</Text>
        </View>
      )}

      {/* Title, top left */}
      <FramedCard style={[styles.infoCard, { top: topInset - 40 }]}>
        <Chip
          label={
            phase === "done"
              ? isFlock
                ? "Flock"
                : unsure
                  ? "Unsure"
                  : "Not Flock"
              : "Report"
          }
          tone={phase === "done" && isFlock ? "alert" : "surface"}
        />
        <Text style={styles.infoTitle}>
          {phase === "idle"
            ? "Report a camera"
            : phase === "processing"
              ? "Checking…"
              : phase === "error"
                ? "Something went wrong"
                : isFlock
                  ? "Flock camera"
                  : unsure
                    ? "Not sure"
                    : "Not a Flock camera"}
        </Text>
      </FramedCard>

      {/* Bottom panel: shutter when idle, the verdict once we have an answer. */}
      <View style={[styles.bottomCard, { paddingBottom: bottomInset + 16 }]}>
        {phase === "idle" && (
          <>
            <Text style={styles.body}>
              Line up the camera and take a photo. We'll send it with your location to
              check whether it's a Flock camera.
            </Text>
            <Pressable
              onPress={capture}
              accessibilityRole="button"
              accessibilityLabel="Take photo"
              style={({ pressed }) => [styles.shutter, pressed && styles.shutterPressed]}
            >
              <View style={styles.shutterInner} />
            </Pressable>
          </>
        )}

        {phase === "processing" && (
          <Text style={styles.body}>Analyzing your photo…</Text>
        )}

        {phase === "error" && (
          <>
            <Text style={styles.headline}>Couldn't check the photo</Text>
            <Text style={styles.body}>{error}</Text>
            <Button label="Try again" onPress={reset} />
          </>
        )}

        {phase === "done" && result && (
          <>
            <View style={styles.verdictRow}>
              <View
                style={[
                  styles.verdictBadge,
                  { backgroundColor: isFlock ? colors.alert : colors.surface },
                ]}
              >
                <Text
                  style={[
                    styles.verdictMark,
                    { color: isFlock ? colors.onAlert : colors.muted },
                  ]}
                >
                  {isFlock ? "!" : unsure ? "?" : "–"}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.headline}>
                  {isFlock
                    ? "It's a Flock camera"
                    : unsure
                      ? "Not sure — try again"
                      : "Not a Flock camera"}
                </Text>
                <Text style={styles.verdictSub}>
                  {Math.round(result.camera_probability * 100)}% camera ·{" "}
                  {Math.round(result.latency_ms)} ms
                </Text>
              </View>
            </View>

            <Text style={styles.body}>
              {isFlock
                ? "This looks like a Flock automated license-plate reader."
                : unsure
                  ? "Couldn't tell for sure. Move closer and take a clearer photo."
                  : "This doesn't look like a Flock camera."}
            </Text>

            <Text style={styles.foot}>
              {coords
                ? `Reported at ${coords.lat.toFixed(5)}, ${coords.lon.toFixed(5)}`
                : "No GPS fix was available for this report."}
            </Text>

            <Button label="Report another" variant="secondary" onPress={reset} />
          </>
        )}
      </View>
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
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
    processing: {
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: "rgba(40,43,74,0.45)",
      gap: 12,
    },
    processingText: {
      fontFamily: fonts.sansBold,
      fontSize: 15,
      color: c.onAlert,
    },
    infoCard: {
      position: "absolute",
      left: 16,
      paddingHorizontal: 12,
      paddingVertical: 10,
      gap: 6,
      maxWidth: 250,
    },
    infoTitle: { fontFamily: fonts.sansBold, fontSize: 16, color: c.ink },
    bottomCard: {
      position: "absolute",
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: c.paper,
      borderTopWidth: BORDER,
      borderTopColor: c.outline,
      paddingHorizontal: 16,
      paddingTop: 16,
      gap: 12,
      alignItems: "center",
    },
    headline: {
      fontFamily: fonts.heading,
      fontSize: 18,
      color: c.ink,
      alignSelf: "stretch",
    },
    body: {
      fontFamily: fonts.sans,
      fontSize: 14,
      lineHeight: 20,
      color: c.muted,
      alignSelf: "stretch",
    },
    foot: {
      fontFamily: fonts.sans,
      fontSize: 12,
      color: c.muted,
      alignSelf: "stretch",
    },
    verdictRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      alignSelf: "stretch",
    },
    verdictBadge: {
      width: 48,
      height: 48,
      borderRadius: 24,
      borderWidth: BORDER,
      borderColor: c.outline,
      alignItems: "center",
      justifyContent: "center",
    },
    verdictMark: { fontFamily: fonts.heading, fontSize: 26 },
    verdictSub: {
      fontFamily: fonts.sansBold,
      fontSize: 13,
      color: c.muted,
      marginTop: 2,
    },
    shutter: {
      width: 74,
      height: 74,
      borderRadius: 37,
      borderWidth: 4,
      borderColor: c.alert,
      backgroundColor: c.surface,
      alignItems: "center",
      justifyContent: "center",
    },
    shutterPressed: { opacity: 0.7 },
    shutterInner: {
      width: 56,
      height: 56,
      borderRadius: 28,
      backgroundColor: c.alert,
    },
  });
