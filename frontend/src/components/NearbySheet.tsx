import { StyleSheet, Text, View } from "react-native";
import { formatDistance } from "../geo";
import { useSettings } from "../settings";
import {
  BORDER,
  BORDER_THIN,
  fonts,
  radii,
  useThemedStyles,
  type Palette,
} from "../theme";
import type { BackendStatus, Camera } from "../types";
import { RadiusSlider } from "./RadiusSlider";
import { Button, Chip } from "./ui";

/**
 * Panel on the map, just above the tab bar. Plain: a title line, three labeled numbers, the radius slider,
 * and one button. Shows the backend's answer as-is: cameras[0] is the nearest, `alert` means "in view".
 */
export function NearbySheet({
  cameras,
  backend,
  bottom,
  onLookAround,
  onLayoutHeight,
}: {
  cameras: Camera[];
  backend: BackendStatus;
  bottom: number; // height of the tab bar underneath
  onLookAround: () => void;
  onLayoutHeight: (h: number) => void;
}) {
  const { units, radius, mode } = useSettings();
  const s = useThemedStyles(makeStyles);
  const nearest = cameras[0];
  const inView = cameras.some((cam) => cam.alert);

  const title =
    backend === "error"
      ? "Can't reach the server"
      : !nearest
        ? "No cameras nearby"
        : (`Closest camera: ${nearest.latitude}, ${nearest.longitude}` ?? "Closest camera");

  return (
    <View
      style={[s.sheet, { bottom }]}
      onLayout={(e) => onLayoutHeight(e.nativeEvent.layout.height)}
    >
      <View style={s.head}>
        <Text style={s.title} numberOfLines={1} accessibilityRole="header">
          {title}
        </Text>
        <View style={s.subRow}>
          <Text style={s.sub}>
            {backend === "error"
              ? "Check the server address in settings."
              : !nearest
                ? `No cameras within ${formatDistance(radius, units)}`
                : nearest.distance_m != null
                  ? `${formatDistance(nearest.distance_m, units)} from you`
                  : "Nearest camera"}
          </Text>
          {backend !== "error" && inView && (
            <Chip label="In view" tone="alert" />
          )}
          {backend !== "error" && !nearest && <Chip label="Clear" tone="success" />}
        </View>
      </View>

      <View style={s.tiles}>
        <Tile value={String(cameras.length)} label="In range" />
        <Tile value={mode === "driver" ? "Driving" : "Walking"} label="Mode" />
        <Tile value={SERVER_LABEL[backend]} label="Server Status" />
      </View>

      <View style={s.sliderBox}>
        <RadiusSlider />
      </View>

      <Button label="Open camera" icon="camera" onPress={onLookAround} />
    </View>
  );
}

function Tile({ value, label }: { value: string; label: string }) {
  const s = useThemedStyles(makeStyles);
  return (
    <View style={s.tile} accessible accessibilityLabel={`${label}: ${value}`}>
      <Text style={s.tileLabel}>{label.toUpperCase()}</Text>
      <Text style={s.tileValue} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
    </View>
  );
}

const SERVER_LABEL: Record<BackendStatus, string> = {
  off: "Idle",
  connecting: "…",
  ok: "Live",
  error: "Down",
};

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    sheet: {
      position: "absolute",
      left: 0,
      right: 0,
      backgroundColor: c.surfaceContainerLow,
      borderTopWidth: BORDER,
      borderColor: c.outlineVariant,
      paddingTop: 14,
      paddingBottom: 12,
      paddingHorizontal: 16,
      gap: 12,
    },
    head: { gap: 4 },
    title: { fontFamily: fonts.heading, fontSize: 20, color: c.onSurface },
    subRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      flexWrap: "wrap",
    },
    sub: { fontFamily: fonts.sans, fontSize: 14, color: c.onSurfaceVariant },
    tiles: { flexDirection: "row", gap: 8 },
    tile: {
      flex: 1,
      borderRadius: radii.tile,
      backgroundColor: c.surfaceContainerHigh,
      borderWidth: BORDER_THIN,
      borderColor: c.outlineVariant,
      paddingVertical: 8,
      paddingHorizontal: 10,
      gap: 2,
    },
    tileValue: { fontFamily: fonts.sansBold, fontSize: 16, color: c.onSurface },
    tileLabel: {
      fontFamily: fonts.sansBold,
      fontSize: 10,
      letterSpacing: 0.6,
      color: c.onSurfaceVariant,
    },
    sliderBox: {
      backgroundColor: c.surfaceContainerHigh,
      borderRadius: radii.tile,
      borderWidth: BORDER_THIN,
      borderColor: c.outlineVariant,
      paddingHorizontal: 12,
      paddingTop: 8,
      paddingBottom: 2,
    },
  });
