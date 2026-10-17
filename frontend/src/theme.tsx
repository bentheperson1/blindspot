import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';
import { useSettings } from './settings';

/**
 * Visual language: an engraved city map.
 * Dark is the map at dusk (espresso and cream); light is the same map printed on paper.
 * Burnt orange marks cameras, muted teal marks pins. Playfair Display for headings and
 * numbers, its small-caps cut for navigation, Nunito Sans for small details.
 */
export type Palette = {
  scheme: 'dark' | 'light';
  bg: string;
  surface: string;
  surfaceHi: string;
  line: string;
  text: string;
  muted: string;
  accent: string; // cameras in range, active state
  alert: string; // camera close by
  teal: string; // pin fill
  tealText: string; // teal readable on bg
  button: string; // primary button fill
  onButton: string; // primary button text
  glass: string; // translucent panels over the map / camera
  mapTint: string; // wash over the base map
  radiusFill: string;
  radiusStroke: string;
  cone: string;
  coneStroke: string;
};

const dark: Palette = {
  scheme: 'dark',
  bg: '#1F1A16',
  surface: '#2A2420',
  surfaceHi: '#352D28',
  line: '#463C35',
  text: '#EFE4D6',
  muted: '#A8998A',
  accent: '#E8813C',
  alert: '#E8573A',
  teal: '#2F7D6D',
  tealText: '#6FB3A2',
  button: '#F7E7D7',
  onButton: '#2A1F18',
  glass: 'rgba(31,26,22,0.93)',
  mapTint: 'rgba(42,30,20,0.42)',
  radiusFill: 'rgba(232,129,60,0.06)',
  radiusStroke: 'rgba(232,129,60,0.85)',
  cone: 'rgba(232,87,58,0.18)',
  coneStroke: 'rgba(232,87,58,0.7)',
};

const light: Palette = {
  scheme: 'light',
  bg: '#F3EADC',
  surface: '#FBF5EC',
  surfaceHi: '#EFE3D3',
  line: '#D8C9B5',
  text: '#2A1F18',
  muted: '#76665A',
  accent: '#C25E1C',
  alert: '#B83D26',
  teal: '#2F7D6D',
  tealText: '#25695B',
  button: '#2A1F18',
  onButton: '#F7E7D7',
  glass: 'rgba(251,245,236,0.95)',
  mapTint: 'rgba(214,190,160,0.22)',
  radiusFill: 'rgba(194,94,28,0.07)',
  radiusStroke: 'rgba(194,94,28,0.85)',
  cone: 'rgba(184,61,38,0.15)',
  coneStroke: 'rgba(184,61,38,0.7)',
};

export const fonts = {
  display: 'PlayfairDisplay_700Bold',
  displayBlack: 'PlayfairDisplay_900Black',
  caps: 'PlayfairDisplaySC_700Bold',
  capsRegular: 'PlayfairDisplaySC_400Regular',
  sans: 'NunitoSans_400Regular',
  sansSemi: 'NunitoSans_600SemiBold',
  sansBold: 'NunitoSans_700Bold',
};

// Controls are tight, cards are soft, pins are round.
export const radii = { control: 8, card: 14, sheet: 22 };

const ThemeContext = createContext<Palette>(dark);

/** Picks the palette from Settings → Appearance (dark, light, or match the phone). */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const { appearance } = useSettings();
  const system = useColorScheme();
  const palette = appearance === 'system' ? (system === 'light' ? light : dark) : appearance === 'light' ? light : dark;
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
