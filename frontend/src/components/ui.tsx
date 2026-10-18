import { Feather } from "@expo/vector-icons";
import {
  memo,
  useEffect,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import {
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Circle, Rect } from "react-native-svg";
import {
  BORDER,
  BORDER_THIN,
  fonts,
  radii,
  useColors,
  useThemedStyles,
  type Palette,
} from "../theme";

type IconName = ComponentProps<typeof Feather>["name"];

/** Plain page background. (Name kept from the old graph-paper version so screens didn't need renaming.) */
export const PaperBackground = memo(function PaperBackground({
  style,
}: {
  style?: StyleProp<ViewStyle>;
}) {
  const c = useColors();
  return (
    <View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, { backgroundColor: c.paper }, style]}
    />
  );
});

/** Flat rectangular button. Primary = filled, secondary = outlined. */
export function Button({
  label,
  onPress,
  variant = "primary",
  icon,
  style,
}: {
  label: string;
  onPress: () => void;
  variant?: "primary" | "secondary";
  icon?: IconName;
  style?: StyleProp<ViewStyle>;
}) {
  const c = useColors();
  const s = useThemedStyles(makeStyles);
  const primary = variant === "primary";
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [
        s.btn,
        primary ? s.btnPrimary : s.btnSecondary,
        pressed && s.pressed,
        style,
      ]}
    >
      {icon && (
        <Feather name={icon} size={18} color={primary ? c.onPrimary : c.ink} />
      )}
      <Text style={[s.btnText, { color: primary ? c.onPrimary : c.ink }]}>
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * Square icon button. `label` is read by screen readers; pass `showLabel` to also print it
 * next to the icon (used where an icon alone wouldn't be obvious).
 */
export function IconButton({
  icon,
  label,
  onPress,
  size = 46,
  showLabel = false,
  tone = "surface",
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  size?: number;
  showLabel?: boolean;
  tone?: "surface" | "primary";
}) {
  const c = useColors();
  const s = useThemedStyles(makeStyles);
  const primary = tone === "primary";
  const ink = primary ? c.onPrimary : c.ink;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={4}
      style={({ pressed }) => [
        s.iconBtn,
        { height: size, minWidth: size, paddingHorizontal: showLabel ? 14 : 0 },
        primary && { backgroundColor: c.primary, borderColor: c.primary },
        pressed && s.pressed,
      ]}
    >
      <Feather name={icon} size={20} color={ink} />
      {showLabel && (
        <Text style={[s.iconBtnText, { color: ink }]}>{label}</Text>
      )}
    </Pressable>
  );
}

/** Small status tag. Only "alert" uses the red highlight; everything else is neutral. */
export function Chip({
  label,
  tone = "surface",
}: {
  label: string;
  tone?: "alert" | "sage" | "lilac" | "surface" | "ink";
}) {
  const c = useColors();
  const s = useThemedStyles(makeStyles);
  const bg = tone === "alert" ? c.alert : tone === "ink" ? c.ink : c.surface;
  const fg = tone === "alert" ? c.onAlert : tone === "ink" ? c.paper : c.ink;
  return (
    <View
      style={[
        s.chip,
        {
          backgroundColor: bg,
          borderColor: tone === "alert" ? c.alert : c.outline,
        },
      ]}
    >
      <Text style={[s.chipText, { color: fg }]}>{label.toUpperCase()}</Text>
    </View>
  );
}

/** Plain bordered card. */
export function FramedCard({
  children,
  radius = radii.card,
  style,
  tint,
}: {
  children: ReactNode;
  radius?: number;
  style?: StyleProp<ViewStyle>;
  tint?: string;
}) {
  const c = useColors();
  const s = useThemedStyles(makeStyles);
  return (
    <View
      style={[
        s.card,
        { borderRadius: radius, backgroundColor: tint ?? c.surface },
        style,
      ]}
    >
      {children}
    </View>
  );
}

/**
 * The Blind Spot mark: the street camera from the logo (cream body, red outline,
 * indigo lens ring, red status dot), on a pole.
 */
export function LogoMark({ size, label }: { size: number; label?: string }) {
  return (
    <View
      accessible={!!label}
      accessibilityRole={label ? "image" : undefined}
      accessibilityLabel={label}
      importantForAccessibility={label ? "yes" : "no-hide-descendants"}
    >
      <Svg viewBox="0 0 120 120" width={size} height={size}>
        <Rect
          x={22}
          y={56}
          width={10}
          height={62}
          fill="#EEEBDA"
          stroke="#B71947"
          strokeWidth={3}
        />
        <Rect
          x={4}
          y={14}
          width={104}
          height={48}
          rx={24}
          fill="#EEEBDA"
          stroke="#B71947"
          strokeWidth={3}
        />
        <Circle
          cx={80}
          cy={38}
          r={13}
          fill="#282B4A"
          stroke="#3E3F66"
          strokeWidth={5}
        />
        <Circle cx={58} cy={28} r={4} fill="#B71947" />
      </Svg>
    </View>
  );
}

export type Tab = "map" | "ar" | "settings";

export const TAB_BAR_H = 62;

const TABS: { key: Tab; label: string; icon: IconName }[] = [
  { key: "map", label: "Map", icon: "map" },
  { key: "ar", label: "Camera", icon: "camera" },
  { key: "settings", label: "Settings", icon: "settings" },
];

/** Bottom navigation: three labeled tabs, always visible. The active tab gets a red bar on top. */
export function TabBar({
  value,
  onChange,
}: {
  value: Tab;
  onChange: (t: Tab) => void;
}) {
  const c = useColors();
  const s = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  // On Android the bar would ride up on top of the keyboard and hide what you're typing, so tuck it away.
  const [keyboardUp, setKeyboardUp] = useState(false);
  useEffect(() => {
    if (Platform.OS !== "android") return;
    const show = Keyboard.addListener("keyboardDidShow", () =>
      setKeyboardUp(true),
    );
    const hide = Keyboard.addListener("keyboardDidHide", () =>
      setKeyboardUp(false),
    );
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  if (keyboardUp) return null;
  return (
    <View
      style={[
        s.tabBar,
        { paddingBottom: insets.bottom, height: TAB_BAR_H + insets.bottom },
      ]}
      accessibilityRole="tablist"
    >
      {TABS.map((t) => {
        const on = t.key === value;
        return (
          <Pressable
            key={t.key}
            onPress={() => onChange(t.key)}
            style={({ pressed }) => [
              s.tab,
              pressed && { backgroundColor: c.cream },
            ]}
            accessibilityRole="tab"
            accessibilityLabel={t.label}
            accessibilityState={{ selected: on }}
          >
            <View
              style={[s.tabIndicator, on && { backgroundColor: c.alert }]}
            />
            <Feather name={t.icon} size={22} color={on ? c.ink : c.muted} />
            <Text
              style={[
                s.tabText,
                { color: on ? c.ink : c.muted },
                on && { fontFamily: fonts.sansHeavy },
              ]}
            >
              {t.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

/** Compass heading, e.g. "NW 312°". Display only. */
export const CompassBadge = memo(function CompassBadge({
  heading,
}: {
  heading: number | null;
}) {
  const c = useColors();
  const s = useThemedStyles(makeStyles);
  const label =
    heading == null
      ? "—"
      : `${COMPASS[Math.round(heading / 45) % 8]} ${Math.round(heading)}°`;
  return (
    <View
      style={s.compass}
      accessible
      accessibilityLabel={
        heading == null ? "Compass not ready" : `Heading ${label}`
      }
    >
      <Feather name="compass" size={16} color={c.ink} />
      <Text style={s.compassText}>{label}</Text>
    </View>
  );
});

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    pressed: { opacity: 0.7 },
    btn: {
      height: 52,
      borderRadius: radii.pill,
      borderWidth: BORDER,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      paddingHorizontal: 16,
    },
    btnPrimary: { backgroundColor: c.primary, borderColor: c.primary },
    btnSecondary: { backgroundColor: c.surface, borderColor: c.outline },
    btnText: { fontFamily: fonts.sansBold, fontSize: 16 },
    iconBtn: {
      flexDirection: "row",
      gap: 8,
      borderRadius: radii.icon,
      backgroundColor: c.surface,
      borderWidth: BORDER,
      borderColor: c.outline,
      alignItems: "center",
      justifyContent: "center",
    },
    iconBtnText: { fontFamily: fonts.sansBold, fontSize: 14 },
    chip: {
      alignSelf: "flex-start",
      height: 24,
      paddingHorizontal: 8,
      borderRadius: 4,
      borderWidth: BORDER_THIN,
      justifyContent: "center",
    },
    chipText: { fontFamily: fonts.sansHeavy, fontSize: 11, letterSpacing: 0.6 },
    card: { borderWidth: BORDER, borderColor: c.outline, overflow: "hidden" },
    tabBar: {
      position: "absolute",
      left: 0,
      right: 0,
      bottom: 0,
      flexDirection: "row",
      backgroundColor: c.surface,
      borderTopWidth: BORDER,
      borderTopColor: c.outline,
    },
    tab: { flex: 1, alignItems: "center", justifyContent: "center", gap: 3 },
    tabIndicator: {
      position: "absolute",
      top: 0,
      left: "25%",
      right: "25%",
      height: 3,
      backgroundColor: "transparent",
    },
    tabText: { fontFamily: fonts.sansSemi, fontSize: 12 },
    compass: {
      height: 40,
      paddingHorizontal: 10,
      borderRadius: radii.icon,
      backgroundColor: c.surface,
      borderWidth: BORDER,
      borderColor: c.outline,
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
    },
    compassText: { fontFamily: fonts.sansBold, fontSize: 13, color: c.ink },
  });
