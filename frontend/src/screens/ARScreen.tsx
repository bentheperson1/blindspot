import { CameraView, useCameraPermissions } from 'expo-camera';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { useEffect, useRef, useState } from 'react';
import { Image, Platform, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { buildPayload, lensFromExif, sendFrame, type FrameResult } from '../api';
import { Button, Chip, FramedCard, LogoMark } from '../components/ui';
import { FRAME_INTERVAL_MS, FRAME_JPEG_QUALITY, FRAME_WIDTH_PX } from '../config';
import type { Telemetry } from '../sensors';
import { useSettings } from '../settings';
import { BORDER, fonts, radii, useThemedStyles, type Palette } from '../theme';
import type { BackendStatus, Detection } from '../types';

// Fixed at no zoom so the focal length doesn't change under the backend. Sent with every frame in `extra.lens`.
const CAMERA_ZOOM = 0;

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
  const [status, setStatus] = useState<BackendStatus>('connecting');
  const [result, setResult] = useState<FrameResult>({ detections: [] });
  const detections: Detection[] = result.detections;

  // Latest settings in a ref so changing them doesn't restart the loop.
  const settingsRef = useRef({ radius_m: radius, mode });
  settingsRef.current = { radius_m: radius, mode };
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [showOutputFull, setShowOutputFull] = useState(false);
  const [waitingForSensors, setWaitingForSensors] = useState(false);

  const report = (s: BackendStatus) => {
    setStatus(s);
    onBackendStatus(s);
  };

  // ---- Frame loop: capture -> shrink -> model -> draw ----
  useEffect(() => {
    if (!ready) return;
    let stopped = false;
    report('connecting');

    (async () => {
      while (!stopped) {
        const started = Date.now();
        try {
          // Sensor readings and timestamps are all taken at the moment of capture, so they line up with the frame.
          const telemetry = snapshot();
          const monotonicMs = performance.now();
          const timestampSec = Date.now() / 1000;
          // Don't spend a capture until GPS, compass and motion all have a reading.
          if (!buildPayload(telemetry, null, { timestampSec, monotonicMs }, { platform: Platform.OS, settings: settingsRef.current })) {
            if (!stopped) setWaitingForSensors(true);
          } else {
            if (!stopped) setWaitingForSensors(false);
            // skipProcessing must stay off: with it on, many Android phones return sideways frames.
            // exif: true returns this photo's focal length; the resize below strips EXIF, so it's sent as `extra.lens`.
            const shot = await camRef.current?.takePictureAsync({ quality: 0.5, shutterSound: false, skipProcessing: false, exif: true });
            if (shot && !stopped) {
              const img = await ImageManipulator.manipulate(shot.uri).resize({ width: FRAME_WIDTH_PX }).renderAsync();
              const small = await img.saveAsync({ compress: FRAME_JPEG_QUALITY, format: SaveFormat.JPEG, base64: true });
              const payload = buildPayload(
                telemetry,
                { base64: small.base64 ?? '', width: small.width, height: small.height, cameraWidth: shot.width, cameraHeight: shot.height, lens: lensFromExif(shot.exif, CAMERA_ZOOM) },
                { timestampSec, monotonicMs },
                { platform: Platform.OS, settings: settingsRef.current },
              );
              if (payload) {
                const res = await sendFrame(apiUrl, payload);
                if (!stopped) {
                  setResult(res);
                  setLatencyMs(Date.now() - started);
                  report('ok');
                }
              }
            }
          }
        } catch {
          if (!stopped) {
            setResult({ detections: [] });
            report('error');
          }
        }
        const wait = Math.max(0, FRAME_INTERVAL_MS - (Date.now() - started));
        await new Promise((r) => setTimeout(r, wait));
      }
    })();

    return () => {
      stopped = true;
      onBackendStatus('off');
    };
  }, [ready, apiUrl]);

  // ---- Alert: backend decides via `alert`; if it omits it, any detection counts ----
  const alerting = result.alert ?? detections.length > 0;

  if (!permission) return <View style={styles.fill} />;
  if (!permission.granted) {
    return (
      <View style={[styles.fill, styles.center, { paddingBottom: bottomInset + 28 }]}>
        <LogoMark size={96} />
        <Text style={styles.permTitle} accessibilityRole="header">
          Camera access needed
        </Text>
        <Text style={styles.permBody}>Point your camera at poles and intersections. Each frame is checked for license-plate cameras.</Text>
        <Button label="Allow camera" onPress={requestPermission} style={{ alignSelf: 'stretch' }} />
      </View>
    );
  }

  // What the status strip and bottom text say, from the backend's answer.
  const offline = status === 'error';
  const chip = offline
    ? { label: 'Offline', tone: 'surface' as const }
    : waitingForSensors
      ? { label: 'Waiting', tone: 'surface' as const }
      : alerting
        ? { label: 'In view', tone: 'alert' as const }
        : { label: 'Clear', tone: 'surface' as const };
  const cardTitle = offline
    ? 'No connection'
    : waitingForSensors
      ? 'Warming up'
      : alerting
        ? `Camera spotted${detections.length > 1 ? ` (${detections.length})` : ''}`
        : 'Scanning';
  const headline = offline
    ? "Can't reach the server"
    : waitingForSensors
      ? 'Finding your location and direction'
      : alerting
        ? "You're in a camera's view"
        : 'No cameras detected';
  const body = offline
    ? 'Check the server address in Settings. Frames start sending again on their own.'
    : waitingForSensors
      ? 'Waiting for GPS and the compass. Hold the phone up and move it in a figure-8.'
      : result.message ?? (alerting ? 'A license-plate camera is in frame.' : 'Point the camera at poles and intersections.');

  return (
    <View style={styles.fill}>
      <CameraView ref={camRef} style={StyleSheet.absoluteFill} facing="back" zoom={CAMERA_ZOOM} onCameraReady={() => setReady(true)} animateShutter={false} />

      {/* Model detections. Boxes are normalized 0–1 relative to the frame. */}
      {detections.map((d, i) => (
        <View
          key={i}
          pointerEvents="none"
          style={[styles.detBox, { left: d.box[0] * width, top: d.box[1] * height, width: d.box[2] * width, height: d.box[3] * height }]}
        >
          <View style={styles.detLabelWrap}>
            <Chip label={`${d.label} ${Math.round(d.confidence * 100)}%`} tone="alert" />
          </View>
        </View>
      ))}

      {/* Solid border while a camera is in view (no animation). */}
      {alerting && <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.alertBorder]} />}

      {/* Status, top left */}
      <FramedCard style={[styles.infoCard, { top: topInset - 40 }]}>
        <Chip label={chip.label} tone={chip.tone} />
        <Text style={styles.infoTitle}>{cardTitle}</Text>
      </FramedCard>

      {/* Processed frame from the backend. Tap to toggle full screen. */}
      {result.image ? (
        <Pressable
          onPress={() => setShowOutputFull((v) => !v)}
          style={showOutputFull ? StyleSheet.absoluteFill : [styles.outputThumb, { top: topInset + 12 }]}
          accessibilityRole="button"
          accessibilityLabel={showOutputFull ? 'Close model output' : 'Show model output full screen'}
        >
          <Image source={{ uri: `data:image/jpeg;base64,${result.image}` }} style={StyleSheet.absoluteFill} resizeMode="cover" />
          {!showOutputFull && <Text style={styles.outputLabel}>Model output</Text>}
        </Pressable>
      ) : null}

      {/* Bottom panel, just above the tab bar */}
      <View style={[styles.bottomCard, { bottom: bottomInset }]}>
        <Text style={styles.headline}>{headline}</Text>
        <Text style={styles.body}>{body}</Text>
        {result.image ? (
          <Button
            label={showOutputFull ? 'Show camera' : 'Show model output'}
            variant="secondary"
            onPress={() => setShowOutputFull((v) => !v)}
          />
        ) : null}
        {latencyMs != null && status === 'ok' && <Text style={styles.foot}>Last frame checked in {latencyMs} ms</Text>}
      </View>
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    fill: { flex: 1, backgroundColor: '#282B4A' },
    center: { alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12, backgroundColor: c.paper },
    permTitle: { fontFamily: fonts.heading, color: c.ink, fontSize: 22, textAlign: 'center' },
    permBody: { fontFamily: fonts.sans, color: c.muted, fontSize: 15, lineHeight: 22, textAlign: 'center', maxWidth: 320, marginBottom: 8 },
    detBox: { position: 'absolute', borderWidth: 3, borderColor: c.alert, borderRadius: 4 },
    detLabelWrap: { position: 'absolute', top: -30, left: -3 },
    alertBorder: { borderWidth: 8, borderColor: c.alert },
    infoCard: { position: 'absolute', left: 16, paddingHorizontal: 12, paddingVertical: 10, gap: 6, maxWidth: 220 },
    infoTitle: { fontFamily: fonts.sansBold, fontSize: 16, color: c.ink },
    outputThumb: {
      position: 'absolute',
      right: 16,
      width: 108,
      height: 144,
      borderRadius: radii.tile,
      overflow: 'hidden',
      borderWidth: BORDER,
      borderColor: c.outline,
      backgroundColor: c.paper,
    },
    outputLabel: {
      position: 'absolute',
      bottom: 0,
      left: 0,
      right: 0,
      textAlign: 'center',
      backgroundColor: c.surface,
      color: c.ink,
      fontSize: 11,
      fontFamily: fonts.sansBold,
      paddingVertical: 4,
    },
    bottomCard: {
      position: 'absolute',
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
    body: { fontFamily: fonts.sans, fontSize: 14, lineHeight: 20, color: c.muted },
    foot: { fontFamily: fonts.sans, fontSize: 12, color: c.muted },
  });
