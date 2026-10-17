import { StyleSheet, Text, View } from 'react-native';
import { formatDistance } from '../geo';
import { useSettings } from '../settings';
import { colors, radii } from '../theme';
import type { BackendStatus, Camera } from '../types';

/**
 * Bottom status bar. Shows the backend's answer as-is: the backend sorts nearest-first,
 * so cameras[0] is the nearest, and its `alert` flag sets the color.
 */
export function StatusBar({ cameras, backend }: { cameras: Camera[]; backend: BackendStatus }) {
  const { units, radius, mode } = useSettings();
  const nearest = cameras[0];
  const alerting = cameras.some((c) => c.alert);
  const tone = alerting ? colors.alert : nearest ? colors.warn : colors.accent;

  const headline =
    backend === 'error'
      ? 'Backend unreachable'
      : !nearest
        ? `No cameras within ${formatDistance(radius, units)}`
        : nearest.distance_m != null
          ? `Nearest camera ${formatDistance(nearest.distance_m, units)}`
          : `${cameras.length} camera${cameras.length > 1 ? 's' : ''} nearby`;

  return (
    <View style={[styles.bar, { borderColor: tone }]}>
      <View style={[styles.dot, { backgroundColor: tone }]} />
      <View style={{ flex: 1 }}>
        <Text style={styles.headline} numberOfLines={1}>
          {headline}
        </Text>
        <Text style={styles.sub} numberOfLines={1}>
          {cameras.length} in range · {mode === 'driver' ? 'Driver' : 'Pedestrian'}
        </Text>
      </View>
      <View style={styles.backend}>
        <View style={[styles.miniDot, { backgroundColor: BACKEND_COLOR[backend] }]} />
        <Text style={styles.backendText}>{BACKEND_LABEL[backend]}</Text>
      </View>
    </View>
  );
}

const BACKEND_COLOR: Record<BackendStatus, string> = {
  off: colors.textDim,
  connecting: colors.warn,
  ok: colors.accent,
  error: colors.alert,
};
const BACKEND_LABEL: Record<BackendStatus, string> = {
  off: 'API off',
  connecting: 'API …',
  ok: 'API live',
  error: 'API down',
};

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: 'rgba(22,27,34,0.94)',
    borderRadius: radii.lg,
    borderWidth: 1,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  dot: { width: 12, height: 12, borderRadius: 6 },
  headline: { color: colors.text, fontSize: 15, fontWeight: '700' },
  sub: { color: colors.textDim, fontSize: 12, marginTop: 2 },
  backend: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  miniDot: { width: 7, height: 7, borderRadius: 4 },
  backendText: { color: colors.textDim, fontSize: 11, fontWeight: '600' },
});
