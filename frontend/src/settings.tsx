import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { DEFAULT_API_URL, MILE } from './config';
import type { Appearance, TravelMode, Units, ViewMode } from './types';

export type Settings = {
  view: ViewMode;
  radius: number; // meters
  mode: TravelMode;
  units: Units;
  apiUrl: string;
  appearance: Appearance;
};

const DEFAULTS: Settings = {
  view: 'map',
  radius: 1 * MILE,
  mode: 'pedestrian',
  units: 'imperial',
  apiUrl: DEFAULT_API_URL,
  appearance: 'light',
};

const KEY = 'flock.settings.v1';

type Ctx = Settings & { update: (patch: Partial<Settings>) => void; loaded: boolean };
const SettingsContext = createContext<Ctx | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(KEY)
      .then((raw) => raw && setSettings({ ...DEFAULTS, ...JSON.parse(raw) }))
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  const value = useMemo<Ctx>(
    () => ({
      ...settings,
      loaded,
      update: (patch) =>
        setSettings((prev) => {
          const next = { ...prev, ...patch };
          AsyncStorage.setItem(KEY, JSON.stringify(next)).catch(() => {});
          return next;
        }),
    }),
    [settings, loaded],
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): Ctx {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings must be used inside SettingsProvider');
  return ctx;
}
