import Slider from '@react-native-community/slider';
import { StyleSheet, Text, View } from 'react-native';
import { MILE, RADIUS_MAX_M, RADIUS_MIN_M } from '../config';
import { formatDistance } from '../geo';
import { useSettings } from '../settings';
import { colors } from '../theme';

/** "Radius detection: 0.5 mi ●──── 5 mi" from the whiteboard. */
export function RadiusSlider({ compact = false }: { compact?: boolean }) {
  const { radius, units, update } = useSettings();
  return (
    <View style={[styles.wrap, compact && styles.compact]}>
      <View style={styles.row}>
        <Text style={styles.label}>Detection radius</Text>
        <Text style={styles.value}>{formatDistance(radius, units)}</Text>
      </View>
      <Slider
        minimumValue={RADIUS_MIN_M}
        maximumValue={RADIUS_MAX_M}
        step={0.1 * MILE}
        value={radius}
        onSlidingComplete={(v) => update({ radius: v })}
        minimumTrackTintColor={colors.accent}
        maximumTrackTintColor={colors.border}
        thumbTintColor={colors.accent}
      />
      <View style={styles.row}>
        <Text style={styles.tick}>{formatDistance(RADIUS_MIN_M, units)}</Text>
        <Text style={styles.tick}>{formatDistance(RADIUS_MAX_M, units)}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 4 },
  compact: { paddingHorizontal: 4 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  label: { color: colors.textDim, fontSize: 13, fontWeight: '600', letterSpacing: 0.3 },
  value: { color: colors.text, fontSize: 15, fontWeight: '700', fontVariant: ['tabular-nums'] },
  tick: { color: colors.textDim, fontSize: 11 },
});
