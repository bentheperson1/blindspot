import { StatusBar as SystemStatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { checkHealth, fetchCameras } from './src/api';
import { RadiusSlider } from './src/components/RadiusSlider';
import { StatusBar } from './src/components/StatusBar';
import { CAMERA_REFRESH_MS } from './src/config';
import { ARScreen } from './src/screens/ARScreen';
import { MapScreen } from './src/screens/MapScreen';
import { Segmented, SettingsScreen } from './src/screens/SettingsScreen';
import { useTelemetry } from './src/sensors';
import { SettingsProvider, useSettings } from './src/settings';
import { colors, radii } from './src/theme';
import type { BackendStatus, Camera } from './src/types';

export default function App() {
  return (
    <SafeAreaProvider>
      <SettingsProvider>
        <Main />
      </SettingsProvider>
    </SafeAreaProvider>
  );
}

function Main() {
  const settings = useSettings();
  const { position, permission, snapshot } = useTelemetry();
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [backend, setBackend] = useState<BackendStatus>('off');
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Map view: ask the backend which cameras are near the phone. It filters, sorts and flags alerts.
  useEffect(() => {
    if (!settings.loaded || settings.view !== 'map' || !position) return;
    let cancelled = false;
    const load = async () => {
      const [alive, cams] = await Promise.all([
        checkHealth(settings.apiUrl),
        fetchCameras(settings.apiUrl, { lat: position.latitude, lon: position.longitude, radius_m: settings.radius, mode: settings.mode }),
      ]);
      if (cancelled) return;
      setBackend(alive ? 'ok' : 'error');
      setCameras(cams);
    };
    load();
    const t = setInterval(load, CAMERA_REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [settings.loaded, settings.view, settings.apiUrl, settings.radius, settings.mode, position?.latitude, position?.longitude]);

  return (
    <View style={styles.root}>
      <SystemStatusBar style="light" />

      {settings.view === 'map' ? (
        <MapScreen position={position} cameras={cameras} />
      ) : (
        <ARScreen snapshot={snapshot} onBackendStatus={setBackend} />
      )}

      {/* Top: Map / AR toggle + settings */}
      <SafeAreaView edges={['top']} style={styles.top} pointerEvents="box-none">
        <View style={styles.topRow}>
          <View style={styles.toggle}>
            <Segmented
              options={[
                { value: 'map', label: 'Map' },
                { value: 'ar', label: 'AR' },
              ]}
              value={settings.view}
              onChange={(view) => settings.update({ view })}
            />
          </View>
          <Pressable style={styles.gear} onPress={() => setSettingsOpen(true)} hitSlop={8} accessibilityLabel="Settings">
            <Text style={styles.gearText}>⚙︎</Text>
          </Pressable>
        </View>
        {permission === 'denied' && (
          <View style={styles.banner}>
            <Text style={styles.bannerText}>Location is off. Enable it in system settings so the backend gets your position.</Text>
          </View>
        )}
      </SafeAreaView>

      {/* Bottom (map only): radius slider + status bar. AR view has its own detector readout. */}
      {settings.view === 'map' && (
        <SafeAreaView edges={['bottom']} style={styles.bottom} pointerEvents="box-none">
          <View style={styles.sliderCard}>
            <RadiusSlider compact />
          </View>
          <StatusBar cameras={cameras} backend={backend} />
        </SafeAreaView>
      )}

      <SettingsScreen visible={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  top: { position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: 16, gap: 8 },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8 },
  toggle: {
    flex: 1,
    backgroundColor: 'rgba(22,27,34,0.94)',
    borderRadius: radii.md,
    padding: 3,
    borderWidth: 1,
    borderColor: colors.border,
  },
  gear: {
    width: 46,
    height: 46,
    borderRadius: radii.md,
    backgroundColor: 'rgba(22,27,34,0.94)',
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gearText: { color: colors.text, fontSize: 22 },
  banner: { backgroundColor: 'rgba(242,169,59,0.95)', borderRadius: radii.sm, padding: 10 },
  bannerText: { color: '#2B1A00', fontSize: 13, fontWeight: '600' },
  bottom: { position: 'absolute', bottom: 0, left: 0, right: 0, paddingHorizontal: 16, paddingBottom: 8, gap: 10 },
  sliderCard: {
    backgroundColor: 'rgba(22,27,34,0.94)',
    borderRadius: radii.lg,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
});
