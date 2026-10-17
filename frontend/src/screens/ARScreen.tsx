import { CameraView, useCameraPermissions } from 'expo-camera';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Image, Platform, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { buildPayload, sendFrame, type FrameResult } from '../api';
import { FRAME_INTERVAL_MS, FRAME_JPEG_QUALITY, FRAME_WIDTH_PX } from '../config';
import type { Telemetry } from '../sensors';
import { useSettings } from '../settings';
import { fonts, radii, useColors, useThemedStyles, type Palette } from '../theme';
import type { BackendStatus, Detection } from '../types';

/**
 * AR view: a thin client for the backend model.
 * Each tick it sends a base64 frame + raw GPS + raw rotation/motion sensors,
 * and draws exactly what the backend returns. No math or filtering happens here.
 */
export function ARScreen({
  snapshot,
  onBackendStatus,
}: {
  snapshot: () => Telemetry;
  onBackendStatus: (s: BackendStatus) => void;
}) {
  const [permission, requestPermission] = useCameraPermissions();
  const { apiUrl, radius, mode } = useSettings();
  const colors = useColors();
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
            const shot = await camRef.current?.takePictureAsync({ quality: 0.5, shutterSound: false, skipProcessing: false });
            if (shot && !stopped) {
              const img = await ImageManipulator.manipulate(shot.uri).resize({ width: FRAME_WIDTH_PX }).renderAsync();
              const small = await img.saveAsync({ compress: FRAME_JPEG_QUALITY, format: SaveFormat.JPEG, base64: true });
              const payload = buildPayload(
                telemetry,
                { base64: small.base64 ?? '', width: small.width, height: small.height, cameraWidth: shot.width, cameraHeight: shot.height },
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

  // ---- Alert vignette: backend decides via `alert`; if it omits it, any detection counts ----
  const alerting = result.alert ?? detections.length > 0;
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!alerting) {
      pulse.stopAnimation();
      pulse.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.35, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [alerting]);

  if (!permission) return <View style={styles.fill} />;
  if (!permission.granted) {
    return (
      <View style={[styles.fill, styles.center]}>
        <Text style={styles.permTitle}>Camera access needed</Text>
        <Text style={styles.permBody}>Point your camera at poles and intersections. Each frame is checked for license plate cameras.</Text>
        <Pressable style={styles.permBtn} onPress={requestPermission}>
          <Text style={styles.permBtnText}>Allow camera</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.fill}>
      <CameraView ref={camRef} style={StyleSheet.absoluteFill} facing="back" onCameraReady={() => setReady(true)} animateShutter={false} />

      {/* Processed frame the backend sends back. Tap to toggle full screen. */}
      {result.image ? (
        <Pressable
          onPress={() => setShowOutputFull((v) => !v)}
          style={showOutputFull ? StyleSheet.absoluteFill : styles.outputThumb}
          accessibilityLabel="Model output"
        >
          <Image source={{ uri: `data:image/jpeg;base64,${result.image}` }} style={StyleSheet.absoluteFill} resizeMode="cover" />
          {!showOutputFull && <Text style={styles.outputLabel}>Model output</Text>}
        </Pressable>
      ) : null}

      {/* Model detections. Boxes are normalized 0–1 relative to the frame. */}
      {detections.map((d, i) => (
        <View
          key={i}
          pointerEvents="none"
          style={[styles.detBox, { left: d.box[0] * width, top: d.box[1] * height, width: d.box[2] * width, height: d.box[3] * height }]}
        >
          <Text style={styles.detLabel}>
            {d.label} {Math.round(d.confidence * 100)}%
          </Text>
        </View>
      ))}

      {/* Detector readout */}
      <View pointerEvents="none" style={styles.readout}>
        <View style={[styles.dot, { backgroundColor: alerting ? colors.alert : statusColor(colors, status) }]} />
        <Text style={styles.readoutText}>
          {waitingForSensors
            ? 'Waiting for GPS and compass…'
            : status === 'error'
            ? "Can't reach the server. Check the address in settings."
            : status === 'connecting'
              ? 'Connecting to the server…'
              : result.message
                ? result.message
                : detections.length > 0
                  ? `${detections.length} detection${detections.length > 1 ? 's' : ''}`
                  : 'Looking for cameras'}
        </Text>
        {latencyMs != null && status === 'ok' && <Text style={styles.latency}>{latencyMs} ms</Text>}
      </View>

      {/* Viewfinder corners mark the area the model sees. */}
      <View pointerEvents="none" style={styles.finder}>
        <View style={[styles.corner, styles.cTL, alerting && styles.cornerAlert]} />
        <View style={[styles.corner, styles.cTR, alerting && styles.cornerAlert]} />
        <View style={[styles.corner, styles.cBL, alerting && styles.cornerAlert]} />
        <View style={[styles.corner, styles.cBR, alerting && styles.cornerAlert]} />
      </View>

      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.vignette, { opacity: pulse }]} />
    </View>
  );
}

const statusColor = (c: Palette, s: BackendStatus) =>
  ({ off: c.muted, connecting: c.accent, ok: c.tealText, error: c.alert })[s];

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#000' },
  center: { alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12, backgroundColor: colors.bg },
  permTitle: { fontFamily: fonts.display, color: colors.text, fontSize: 26 },
  permBody: { fontFamily: fonts.sans, color: colors.muted, fontSize: 16, lineHeight: 23, textAlign: 'center', maxWidth: 320 },
  permBtn: { backgroundColor: colors.button, paddingHorizontal: 22, paddingVertical: 13, borderRadius: radii.card, marginTop: 8 },
  permBtnText: { fontFamily: fonts.caps, color: colors.onButton, fontSize: 16 },
  detBox: { position: 'absolute', borderWidth: 3, borderColor: colors.alert, borderRadius: 6 },
  detLabel: {
    position: 'absolute',
    top: -22,
    left: -3,
    backgroundColor: colors.alert,
    color: '#FBF5EC',
    fontSize: 12,
    fontFamily: fonts.sansBold,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    overflow: 'hidden',
  },
  readout: {
    position: 'absolute',
    bottom: 120,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.glass,
    borderRadius: radii.card,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: colors.line,
  },
  dot: { width: 10, height: 10, borderRadius: 5 },
  readoutText: { fontFamily: fonts.sansSemi, color: colors.text, fontSize: 15, marginTop: 2 },
  latency: { fontFamily: fonts.sans, color: colors.muted, fontSize: 13, marginTop: 2 },
  outputThumb: {
    position: 'absolute',
    top: 120,
    right: 16,
    width: 120,
    height: 160,
    borderRadius: radii.card,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: colors.accent,
    backgroundColor: colors.bg,
  },
  outputLabel: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    textAlign: 'center',
    backgroundColor: colors.glass,
    color: colors.text,
    fontSize: 11,
    fontFamily: fonts.sansSemi,
    paddingVertical: 3,
  },
  vignette: { borderWidth: 28, borderColor: 'rgba(255,90,114,0.5)' },
  finder: { position: 'absolute', top: '22%', bottom: '28%', left: '12%', right: '12%' },
  corner: { position: 'absolute', width: 28, height: 28, borderColor: '#F7E7D7', opacity: 0.9 },
  cornerAlert: { borderColor: colors.alert, opacity: 1 },
  cTL: { top: 0, left: 0, borderTopWidth: 2, borderLeftWidth: 2, borderTopLeftRadius: 6 },
  cTR: { top: 0, right: 0, borderTopWidth: 2, borderRightWidth: 2, borderTopRightRadius: 6 },
  cBL: { bottom: 0, left: 0, borderBottomWidth: 2, borderLeftWidth: 2, borderBottomLeftRadius: 6 },
  cBR: { bottom: 0, right: 0, borderBottomWidth: 2, borderRightWidth: 2, borderBottomRightRadius: 6 },
});
