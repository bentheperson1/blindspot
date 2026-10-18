import { CameraView, useCameraPermissions } from 'expo-camera';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Image, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { sendFrame, type FrameResult } from '../api';
import { FRAME_INTERVAL_MS, FRAME_JPEG_QUALITY, FRAME_WIDTH_PX } from '../config';
import type { Telemetry } from '../sensors';
import { useSettings } from '../settings';
import { colors, radii } from '../theme';
import type { BackendStatus, Detection } from '../types';

// resize + encode in one place, releasing native objects so the loop doesn't accumulate memory
async function shrink(uri: string) {
  const context = ImageManipulator.manipulate(uri);

  try {
    const img = await context.resize({ width: FRAME_WIDTH_PX }).renderAsync();

    try {
      return await img.saveAsync({ compress: FRAME_JPEG_QUALITY, format: SaveFormat.JPEG, base64: true });
    } finally {
      img.release();
    }
  } finally {
    context.release();
  }
}

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

  // Latest props in refs: the frame loop effect only re-runs on [ready, apiUrl],
  // so without these it would keep calling whichever versions existed on first mount.
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;

  const onBackendStatusRef = useRef(onBackendStatus);
  onBackendStatusRef.current = onBackendStatus;

  // Size of the frame we last sent, used to map detection boxes onto the screen.
  const frameSizeRef = useRef<{ w: number; h: number } | null>(null);

  const report = (s: BackendStatus) => {
    setStatus(s);
    onBackendStatusRef.current(s);
  };

  // ---- Frame loop: capture -> shrink -> model -> draw ----
  useEffect(() => {
    if (!ready) return;
    let stopped = false;
    report('connecting');

    (async () => {
      // One throwaway photo, only to learn the camera's image size. Nothing is captured after this.
      if (!frameSizeRef.current) {
        try {
          const probe = await camRef.current?.takePictureAsync({ quality: 0.1, shutterSound: false, skipProcessing: true });
          if (probe) frameSizeRef.current = { w: probe.width, h: probe.height };
        } catch {}
      }
      // Fall back to the screen size if the probe failed.
      const size = frameSizeRef.current ?? { w: width, h: height };
      frameSizeRef.current = size;

      while (!stopped) {
        const started = Date.now();

        try {
          const monotonicMs = performance.now();
          const ts = Date.now();
          const telemetry = snapshotRef.current();

          const res = await sendFrame(
            apiUrl,
            { cameraWidth: size.w, cameraHeight: size.h, monotonicMs, ts },
            telemetry,
            settingsRef.current,
          );

          if (!stopped) {
            setResult(res);
            setLatencyMs(Date.now() - started);
            report('ok');
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
      onBackendStatusRef.current('off');
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
        <Text style={styles.permBody}>The detector looks at your camera feed to find surveillance cameras.</Text>
        <Pressable style={styles.permBtn} onPress={requestPermission}>
          <Text style={styles.permBtnText}>Allow camera</Text>
        </Pressable>
      </View>
    );
  }

  // Map normalized frame coordinates onto the screen using the same cover-fit the preview uses.
  const fs = frameSizeRef.current;
  const scale = fs ? Math.max(width / fs.w, height / fs.h) : 1;
  const fit = fs
    ? { w: fs.w * scale, h: fs.h * scale, x: (width - fs.w * scale) / 2, y: (height - fs.h * scale) / 2 }
    : null;

  const dotPos = fit && result.dot ? { x: fit.x + result.dot.x * fit.w, y: fit.y + result.dot.y * fit.h } : null;
  const dotOnScreen = !!dotPos && dotPos.x >= 0 && dotPos.x <= width && dotPos.y >= 0 && dotPos.y <= height;

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
      {fit &&
        detections.map((d, i) => (
          <View
            key={i}
            pointerEvents="none"
            style={[
              styles.detBox,
              {
                left: fit.x + d.box[0] * fit.w,
                top: fit.y + d.box[1] * fit.h,
                width: d.box[2] * fit.w,
                height: d.box[3] * fit.h,
              },
            ]}
          >
            <Text style={styles.detLabel}>
              {d.label} {Math.round(d.confidence * 100)}%
            </Text>
          </View>
        ))}

      {/* Detector readout */}
      <View pointerEvents="none" style={styles.readout}>
        <View style={[styles.dot, { backgroundColor: alerting ? colors.alert : STATUS_COLOR[status] }]} />
        <Text style={styles.readoutText}>
          {status === 'error'
            ? 'Detector offline — check API URL in Settings'
            : status === 'connecting'
              ? 'Connecting to detector…'
              : result.message
                ? result.message
                : result.dot
                  ? 'Target in view'
                  : detections.length > 0
                    ? `${detections.length} detection${detections.length > 1 ? 's' : ''}`
                    : 'Scanning…'}
        </Text>
        {latencyMs != null && status === 'ok' && <Text style={styles.latency}>{latencyMs} ms</Text>}
      </View>

      {dotPos && dotOnScreen && (
        <View
          pointerEvents="none"
          style={[
            styles.targetDot,
            { left: dotPos.x - TARGET_DOT_SIZE / 2, top: dotPos.y - TARGET_DOT_SIZE / 2 },
          ]}
        />
      )}

      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.vignette, { opacity: pulse }]} />
    </View>
  );
}

const STATUS_COLOR: Record<BackendStatus, string> = {
  off: colors.textDim,
  connecting: colors.warn,
  ok: colors.accent,
  error: colors.alert,
};

const TARGET_DOT_SIZE = 20;

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#000' },
  center: { alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12, backgroundColor: colors.bg },
  permTitle: { color: colors.text, fontSize: 20, fontWeight: '700' },
  permBody: { color: colors.textDim, fontSize: 15, textAlign: 'center' },
  permBtn: { backgroundColor: colors.accent, paddingHorizontal: 20, paddingVertical: 12, borderRadius: radii.md, marginTop: 8 },
  permBtnText: { color: '#06231F', fontWeight: '700', fontSize: 15 },
  detBox: { position: 'absolute', borderWidth: 3, borderColor: colors.alert, borderRadius: 6 },
  detLabel: {
    position: 'absolute',
    top: -22,
    left: -3,
    backgroundColor: colors.alert,
    color: '#fff',
    fontSize: 12,
    fontWeight: '800',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    overflow: 'hidden',
  },
  targetDot: {
    position: 'absolute',
    width: TARGET_DOT_SIZE,
    height: TARGET_DOT_SIZE,
    borderRadius: TARGET_DOT_SIZE / 2,
    backgroundColor: colors.alert,
    borderWidth: 2,
    borderColor: '#fff',
  },
  readout: {
    position: 'absolute',
    bottom: 120,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(14,17,22,0.85)',
    borderRadius: radii.lg,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  dot: { width: 10, height: 10, borderRadius: 5 },
  readoutText: { color: colors.text, fontSize: 14, fontWeight: '700' },
  latency: { color: colors.textDim, fontSize: 12, fontVariant: ['tabular-nums'] },
  outputThumb: {
    position: 'absolute',
    top: 120,
    right: 16,
    width: 120,
    height: 160,
    borderRadius: radii.md,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: colors.accent,
    backgroundColor: '#000',
  },
  outputLabel: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    textAlign: 'center',
    backgroundColor: 'rgba(14,17,22,0.8)',
    color: colors.text,
    fontSize: 11,
    fontWeight: '700',
    paddingVertical: 3,
  },
  vignette: { borderWidth: 28, borderColor: 'rgba(229,72,77,0.55)', borderRadius: 4 },
});