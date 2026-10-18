import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useColorScheme } from "react-native";
import { useSettings } from "./settings";

/**
 * Material 3 color scheme. Generated with Google's material-color-utilities (`SchemeFidelity`,
 * contrast 0) from the brand indigo #282B4A: near-black indigo ink, cool near-neutral grays, and
 * the indigo itself on `primaryContainer`. Roles follow https://m3.material.io/styles/color/roles:
 *   surface / surfaceContainer*  -> page ground, then cards, sheets, nav bar in rising emphasis
 *   onSurface / onSurfaceVariant -> primary / secondary text and icons
 *   outline                      -> borders on interactive things (buttons, inputs, chips)
 *   outlineVariant               -> decorative borders and dividers (cards, sheets, nav bar)
 *   alert                        -> custom color: the logo red #B71947, unblended, used only for
 *                                   "camera in view" so it is the one saturated thing on screen
 *   success / warning            -> custom colors for the snapshot verdict, harmonized to the seed
 * Don't hand-pick hex values elsewhere; pick the role. Use `withAlpha` for translucent fills.
 */
export type Palette = {
  scheme: "dark" | "light";
  primary: string;
  onPrimary: string;
  primaryContainer: string;
  onPrimaryContainer: string;
  secondary: string;
  onSecondary: string;
  secondaryContainer: string;
  onSecondaryContainer: string;
  tertiary: string;
  onTertiary: string;
  tertiaryContainer: string;
  onTertiaryContainer: string;
  alert: string;
  onAlert: string;
  error: string;
  onError: string;
  errorContainer: string;
  onErrorContainer: string;
  success: string;
  onSuccess: string;
  successContainer: string;
  onSuccessContainer: string;
  warning: string;
  onWarning: string;
  warningContainer: string;
  onWarningContainer: string;
  surface: string;
  surfaceDim: string;
  surfaceBright: string;
  surfaceContainerLowest: string;
  surfaceContainerLow: string;
  surfaceContainer: string;
  surfaceContainerHigh: string;
  surfaceContainerHighest: string;
  onSurface: string;
  onSurfaceVariant: string;
  outline: string;
  outlineVariant: string;
  inverseSurface: string;
  inverseOnSurface: string;
  inversePrimary: string;
  scrim: string;
  shadow: string;
};

const light: Palette = {
  scheme: "light",
  primary: "#131634",
  onPrimary: "#FFFFFF",
  primaryContainer: "#282B4A",
  onPrimaryContainer: "#9092B7",
  secondary: "#5D5D6C",
  onSecondary: "#FFFFFF",
  secondaryContainer: "#E2E1F3",
  onSecondaryContainer: "#636372",
  tertiary: "#6C5D2F",
  onTertiary: "#FFFFFF",
  tertiaryContainer: "#BDAA74",
  onTertiaryContainer: "#4B3E13",
  alert: "#B71947", // logo red, fixed in both themes
  onAlert: "#FFFFFF",
  error: "#BA1A1A",
  onError: "#FFFFFF",
  errorContainer: "#FFDAD6",
  onErrorContainer: "#93000A",
  success: "#006B54",
  onSuccess: "#FFFFFF",
  successContainer: "#80F8D1",
  onSuccessContainer: "#002117",
  warning: "#8D4F00",
  onWarning: "#FFFFFF",
  warningContainer: "#FFDCC0",
  onWarningContainer: "#2E1600",
  surface: "#FCF8FB",
  surfaceDim: "#DCD9DC",
  surfaceBright: "#FCF8FB",
  surfaceContainerLowest: "#FFFFFF",
  surfaceContainerLow: "#F6F2F6",
  surfaceContainer: "#F0EDF0",
  surfaceContainerHigh: "#EAE7EA",
  surfaceContainerHighest: "#E5E1E5",
  onSurface: "#1C1B1E",
  onSurfaceVariant: "#46464E",
  outline: "#77767E",
  outlineVariant: "#C7C5CE",
  inverseSurface: "#313033",
  inverseOnSurface: "#F3F0F3",
  inversePrimary: "#C2C4EB",
  scrim: "#000000",
  shadow: "#000000",
};

const dark: Palette = {
  scheme: "dark",
  primary: "#C2C4EB",
  onPrimary: "#2B2E4D",
  primaryContainer: "#282B4A",
  onPrimaryContainer: "#9092B7",
  secondary: "#C6C5D6",
  onSecondary: "#2F2F3D",
  secondaryContainer: "#474856",
  onSecondaryContainer: "#B8B7C8",
  tertiary: "#D9C58D",
  onTertiary: "#3B2F05",
  tertiaryContainer: "#BDAA74",
  onTertiaryContainer: "#4B3E13",
  alert: "#B71947", // logo red, fixed in both themes
  onAlert: "#FFFFFF",
  error: "#FFB4AB",
  onError: "#690005",
  errorContainer: "#93000A",
  onErrorContainer: "#FFDAD6",
  success: "#62DBB6",
  onSuccess: "#00382A",
  successContainer: "#00513E",
  onSuccessContainer: "#80F8D1",
  warning: "#FFB877",
  onWarning: "#4B2700",
  warningContainer: "#6C3A00",
  onWarningContainer: "#FFDCC0",
  surface: "#131315",
  surfaceDim: "#131315",
  surfaceBright: "#39393B",
  surfaceContainerLowest: "#0E0E10",
  surfaceContainerLow: "#1C1B1E",
  surfaceContainer: "#201F22",
  surfaceContainerHigh: "#2A2A2C",
  surfaceContainerHighest: "#353437",
  onSurface: "#E5E1E5",
  onSurfaceVariant: "#C7C5CE",
  outline: "#919098",
  outlineVariant: "#46464E",
  inverseSurface: "#E5E1E5",
  inverseOnSurface: "#313033",
  inversePrimary: "#595C7E",
  scrim: "#000000",
  shadow: "#000000",
};

/** `#RRGGBB` + opacity -> `rgba(...)`, for scrims, map overlays and other translucent fills. */
export function withAlpha(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

export const fonts = {
  // One plain sans everywhere (Archivo), like the logo's lettering. No serif or display faces.
  // `accent` is kept so older styles still compile; it's the same plain bold face.
  heading: "Archivo_800ExtraBold",
  headingBold: "Archivo_800ExtraBold",
  accent: "Archivo_700Bold",
  sans: "Archivo_400Regular",
  sansSemi: "Archivo_600SemiBold",
  sansBold: "Archivo_700Bold",
  sansHeavy: "Archivo_800ExtraBold",
};

// Plain, utilitarian: small corner radii, thin flat borders, no shadows.
export const radii = { icon: 8, tile: 8, card: 10, sheet: 14, pill: 10 };
export const BORDER = 1.5;
export const BORDER_THIN = 1;

const ThemeContext = createContext<Palette>(light);

/** Picks the palette from Settings → Appearance (light, dark, or match the phone). */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const { appearance } = useSettings();
  const system = useColorScheme();
  const palette =
    appearance === "system"
      ? system === "dark"
        ? dark
        : light
      : appearance === "dark"
        ? dark
        : light;
  return (
    <ThemeContext.Provider value={palette}>{children}</ThemeContext.Provider>
  );
}

export function useColors(): Palette {
  return useContext(ThemeContext);
}

/** Builds a StyleSheet from the current palette, rebuilt only when the palette changes. */
export function useThemedStyles<T>(make: (c: Palette) => T): T {
  const c = useColors();
  return useMemo(() => make(c), [c]);
}
