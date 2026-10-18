import Slider from "@react-native-community/slider";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { MILE, RADIUS_MAX_M, RADIUS_MIN_M } from "../config";
import { formatDistance } from "../geo";
import { useSettings } from "../settings";
import { fonts, useColors, useThemedStyles, type Palette } from "../theme";

/**
 * Detection radius, 0.5–5 mi.
 *
 * GPS updates re-render the screen about once a second. A controlled slider that
 * receives `value` on every re-render snaps back to the saved radius mid-drag, so:
 *  - `memo` keeps parent re-renders (GPS) from reaching this component at all;
 *  - while dragging, the slider is fed the value it was at when the drag started,
 *    and the label follows a local draft, so nothing can pull the thumb back;
 *  - the saved radius only changes on release.
 */
export const RadiusSlider = memo(function RadiusSlider() {
  const { radius, units, update } = useSettings();
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);

  const [draft, setDraft] = useState(radius);
  const [sliderValue, setSliderValue] = useState(radius);
  const dragging = useRef(false);

  // Follow changes made elsewhere (e.g. the copy of this slider in Settings), but never mid-drag.
  useEffect(() => {
    if (dragging.current) return;
    setDraft(radius);
    setSliderValue(radius);
  }, [radius]);

  const onStart = useCallback(() => {
    dragging.current = true;
  }, []);
  const onChange = useCallback((v: number) => setDraft(v), []);
  const onComplete = useCallback(
    (v: number) => {
      dragging.current = false;
      setDraft(v);
      setSliderValue(v);
      update({ radius: v });
    },
    [update],
  );

  return (
    <View>
      <View style={styles.row}>
        <Text style={styles.label}>Search radius</Text>
        <Text style={styles.value}>{formatDistance(draft, units)}</Text>
      </View>
      <Slider
        style={styles.slider}
        minimumValue={RADIUS_MIN_M}
        maximumValue={RADIUS_MAX_M}
        step={0.1 * MILE}
        value={sliderValue}
        onSlidingStart={onStart}
        onValueChange={onChange}
        onSlidingComplete={onComplete}
        minimumTrackTintColor={colors.alert}
        maximumTrackTintColor={colors.outline}
        thumbTintColor={colors.alert}
        accessibilityLabel="Search radius"
      />
      <View style={styles.row}>
        <Text style={styles.tick}>{formatDistance(RADIUS_MIN_M, units)}</Text>
        <Text style={styles.tick}>{formatDistance(RADIUS_MAX_M, units)}</Text>
      </View>
    </View>
  );
});

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    row: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "baseline",
    },
    label: { fontFamily: fonts.sansBold, fontSize: 14, color: c.ink },
    value: { fontFamily: fonts.sansBold, fontSize: 16, color: c.ink },
    slider: { height: 34 },
    tick: { fontFamily: fonts.sans, fontSize: 12, color: c.muted },
  });
