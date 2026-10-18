import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';
import { useSettings } from './settings';

/**
 * Blind Spot palette. Every color is one of the three brand colors or a tint/shade of one:
 *   #282B4A midnight indigo -> text and primary buttons (light) / ground (dark)
 *   #EEEBDA vanilla cream   -> ground (light) / text and primary buttons (dark)
 *   #B71947 logo red        -> small highlights only: "in view", selected controls, search radius,
 *                              slider thumb, sheet handle, section labels, serif accent words
 * Layout is deliberately plain: flat cards, thin borders, one sans font, labeled controls.
 */
export type Palette = {
  scheme: 'dark' | 'light';
  paper: string; // page ground
  grid: string; // graph-paper lines
  surface: string; // white cards, icon buttons
  cream: string; // secondary buttons, framed cards
  ink: string; // primary text
  outline: string; // borders on buttons, cards, chips (neutral gray)
  shadow: string; // hard offset shadow under primary buttons
  muted: string; // secondary text
  divider: string;
  tan: string; // dashed inner outlines (blue tint)
  primary: string; // main action buttons
  onPrimary: string;
  alert: string; // "in view" (blue)
  onAlert: string;
  peach: string; // tinted tiles
  sage: string; // "clear" tiles and chips (green)
  lilac: string;
  accentText: string; // blue for serif accent words, dark enough to read on the ground
  crimson: string; // crimson detail lines (search radius, handles, labels)
  mapTint: string;
  radiusFill: string;
  radiusStroke: string;
  cone: string;
  coneStroke: string;
};

const light: Palette = {
  scheme: 'light',
  paper: '#EEEBDA', // vanilla cream
  grid: '#E0DED0', // cream, 7% toward indigo
  surface: '#F8F7F0', // cream, 60% tint
  cream: '#F4F2E7', // cream, 35% tint
  ink: '#282B4A', // midnight indigo
  outline: '#8B8B92', // indigo, halfway to cream
  shadow: '#282B4A',
  muted: '#636575', // indigo, 30% toward cream
  divider: '#D0CEC4', // cream, 15% toward indigo
  tan: '#A9A8A8', // indigo, 65% toward cream
  primary: '#282B4A',
  onPrimary: '#EEEBDA',
  alert: '#B71947', // logo red
  onAlert: '#EEEBDA',
  peach: '#D6D4C9', // cream, 12% toward indigo
  sage: '#C2C1BA', // cream, 22% toward indigo
  lilac: '#E4C5C0', // logo red, 82% toward cream
  accentText: '#282B4A',
  crimson: '#B71947',
  mapTint: 'rgba(238,235,218,0.22)',
  radiusFill: 'rgba(183,25,71,0.08)',
  radiusStroke: '#B71947',
  cone: 'rgba(40,43,74,0.22)',
  coneStroke: '#282B4A',
};

const dark: Palette = {
  scheme: 'dark',
  paper: '#282B4A', // midnight indigo
  grid: '#343753', // indigo, 6% toward cream
  surface: '#3E405A', // indigo, 11% toward cream
  cream: '#323551', // indigo, 5% toward cream
  ink: '#EEEBDA', // vanilla cream
  outline: '#6D6E7C', // indigo, 35% toward cream
  shadow: '#141625', // indigo, 50% shade
  muted: '#B3B1AF', // indigo, 70% toward cream
  divider: '#464860', // indigo, 15% toward cream
  tan: '#5A5B6E', // indigo, 25% toward cream
  primary: '#EEEBDA',
  onPrimary: '#282B4A',
  alert: '#B71947', // logo red
  onAlert: '#EEEBDA',
  peach: '#4A4C62', // indigo, 17% toward cream
  sage: '#5F6172', // indigo, 28% toward cream
  lilac: '#772148', // indigo, 55% toward logo red
  accentText: '#EEEBDA',
  crimson: '#B71947',
  mapTint: 'rgba(40,43,74,0.32)',
  radiusFill: 'rgba(183,25,71,0.14)',
  radiusStroke: '#B71947',
  cone: 'rgba(238,235,218,0.20)',
  coneStroke: '#EEEBDA',
};

export const fonts = {
  // One plain sans everywhere (Archivo), like the logo's lettering. No serif or display faces.
  // `accent` is kept so older styles still compile; it's the same plain bold face.
  heading: 'Archivo_800ExtraBold',
  headingBold: 'Archivo_800ExtraBold',
  accent: 'Archivo_700Bold',
  sans: 'Archivo_400Regular',
  sansSemi: 'Archivo_600SemiBold',
  sansBold: 'Archivo_700Bold',
  sansHeavy: 'Archivo_800ExtraBold',
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
  const palette = appearance === 'system' ? (system === 'dark' ? dark : light) : appearance === 'dark' ? dark : light;
  return <ThemeContext.Provider value={palette}>{children}</ThemeContext.Provider>;
}

export function useColors(): Palette {
  return useContext(ThemeContext);
}

/** Builds a StyleSheet from the current palette, rebuilt only when the palette changes. */
export function useThemedStyles<T>(make: (c: Palette) => T): T {
  const c = useColors();
  return useMemo(() => make(c), [c]);
}
