import { Feather } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { formatDistance } from '../geo';
import { useSettings } from '../settings';
import { fonts, radii, useColors, useThemedStyles, type Palette } from '../theme';
import type { BackendStatus, Camera } from '../types';

/**
 * Info card for the nearest camera, styled after a place card on an engraved map.
 * Shows the backend's answer as-is: cameras[0] is the nearest, `alert` sets the color.
 */
export function StatusBar({
  cameras,
  backend,
  onScan,
}: {
  cameras: Camera[];
  backend: BackendStatus;
  onScan: () => void;
}) {
  const { units, radius, mode } = useSettings();
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);
  const nearest = cameras[0];
  const alerting = cameras.some((c) => c.alert);

  const title =
    backend === 'error' ? 'Server offline' : !nearest ? 'All clear' : alerting ? 'Camera close by' : (nearest.name ?? 'Nearest camera');

  const figure =
    backend === 'error' ? null : nearest?.distance_m != null ? formatDistance(nearest.distance_m, units) : null;

  const detail =
    backend === 'error'
      ? "Can't reach the server. Check the address in settings."
      : !nearest
        ? `No cameras within ${formatDistance(radius, units)}.`
        : null;

  return (
    <View style={styles.card}>
      <View style={styles.body}>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>

        {figure && <Text style={[styles.figure, { color: alerting ? colors.alert : colors.accent }]}>{figure}</Text>}
        {detail && <Text style={styles.detail}>{detail}</Text>}

        <View style={styles.meta}>
          {nearest && backend !== 'error' && (
            <View style={styles.metaItem}>
              <Feather name="map-pin" size={13} color={colors.accent} />
              <Text style={styles.metaText}>{cameras.length} in range</Text>
            </View>
          )}
          <View style={styles.metaItem}>
            <Feather name={mode === 'driver' ? 'truck' : 'user'} size={13} color={colors.accent} />
            <Text style={styles.metaText}>{mode === 'driver' ? 'Driving' : 'Walking'}</Text>
          </View>
          <View style={styles.metaItem}>
            <View style={[styles.dot, { backgroundColor: serverColor(colors, backend) }]} />
            <Text style={styles.metaText}>{SERVER_LABEL[backend]}</Text>
          </View>
        </View>
      </View>

      <Pressable
        onPress={onScan}
        style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
        accessibilityRole="button"
      >
        <Text style={styles.buttonText}>Scan with camera</Text>
      </Pressable>
    </View>
  );
}

const serverColor = (c: Palette, b: BackendStatus) =>
  ({ off: c.muted, connecting: c.accent, ok: c.tealText, error: c.alert })[b];
const SERVER_LABEL: Record<BackendStatus, string> = {
  off: 'Server idle',
  connecting: 'Connecting',
  ok: 'Server live',
  error: 'Server down',
};

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
  card: {
    backgroundColor: colors.glass,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.line,
    overflow: 'hidden',
  },
  body: { paddingHorizontal: 18, paddingTop: 16, paddingBottom: 14 },
  title: { fontFamily: fonts.display, fontSize: 21, color: colors.text },
  figure: { fontFamily: fonts.displayBlack, fontSize: 40, lineHeight: 48, marginTop: 2 },
  detail: { fontFamily: fonts.sans, fontSize: 15, lineHeight: 21, color: colors.muted, marginTop: 4 },
  meta: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 16, rowGap: 6, marginTop: 10 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  metaText: { fontFamily: fonts.sans, fontSize: 13, color: colors.muted },
  dot: { width: 7, height: 7, borderRadius: 4 },
  button: {
    backgroundColor: colors.button,
    marginHorizontal: 10,
    marginBottom: 10,
    borderRadius: radii.control,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonPressed: { opacity: 0.85 },
  buttonText: { fontFamily: fonts.caps, fontSize: 15, color: colors.onButton, letterSpacing: 0.3 },
});
