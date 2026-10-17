import { Feather } from '@expo/vector-icons';
import { NunitoSans_400Regular, NunitoSans_600SemiBold, NunitoSans_700Bold } from '@expo-google-fonts/nunito-sans';
import { PlayfairDisplay_700Bold, PlayfairDisplay_900Black, useFonts } from '@expo-google-fonts/playfair-display';
import { PlayfairDisplaySC_400Regular, PlayfairDisplaySC_700Bold } from '@expo-google-fonts/playfair-display-sc';
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
import { SettingsScreen } from './src/screens/SettingsScreen';
import { useTelemetry } from './src/sensors';
import { SettingsProvider, useSettings } from './src/settings';
import { fonts, radii, ThemeProvider, useColors, useThemedStyles, type Palette } from './src/theme';
import type { BackendStatus, Camera, ViewMode } from './src/types';

export default function App() {
  const [fontsLoaded] = useFonts({
    PlayfairDisplay_700Bold,
    PlayfairDisplay_900Black,
    PlayfairDisplaySC_400Regular,
    PlayfairDisplaySC_700Bold,
    NunitoSans_400Regular,
    NunitoSans_600SemiBold,
    NunitoSans_700Bold,
  });
  if (!fontsLoaded) return <View style={{ flex: 1, backgroundColor: '#1F1A16' }} />;
  return (
    <SafeAreaProvider>
      <SettingsProvider>
        <ThemeProvider>
          <Main />
        </ThemeProvider>
      </SettingsProvider>
    </SafeAreaProvider>
  );
}

function Main() {
  const settings = useSettings();
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);
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
      <SystemStatusBar style={colors.scheme === 'dark' || settings.view === 'ar' ? 'light' : 'dark'} />

      {settings.view === 'map' ? (
        <MapScreen position={position} cameras={cameras} />
      ) : (
        <ARScreen snapshot={snapshot} onBackendStatus={setBackend} />
      )}

      {/* Top: mode tabs on the left, the one settings button on the right */}
      <SafeAreaView edges={['top']} style={styles.top} pointerEvents="box-none">
        <View style={styles.topRow}>
          <ModeTabs value={settings.view} onChange={(view) => settings.update({ view })} />
          <Pressable
            style={({ pressed }) => [styles.square, pressed && styles.squarePressed]}
            onPress={() => setSettingsOpen(true)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Settings"
          >
            <Feather name="sliders" size={19} color={colors.text} />
          </Pressable>
        </View>
        {permission === 'denied' && (
          <View style={styles.banner}>
            <Text style={styles.bannerText}>Location is off. Turn it on in your phone's settings so the server knows where you are.</Text>
          </View>
        )}
      </SafeAreaView>

      {/* Bottom (map only): radius + nearest camera card. The AR view has its own readout. */}
      {settings.view === 'map' && (
        <SafeAreaView edges={['bottom']} style={styles.bottom} pointerEvents="box-none">
          <View style={styles.sliderCard}>
            <RadiusSlider />
          </View>
          <StatusBar cameras={cameras} backend={backend} onScan={() => settings.update({ view: 'ar' })} />
        </SafeAreaView>
      )}

      <SettingsScreen visible={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </View>
  );
}

function ModeTabs({ value, onChange }: { value: ViewMode; onChange: (v: ViewMode) => void }) {
  const styles = useThemedStyles(makeStyles);
  const items: { value: ViewMode; label: string }[] = [
    { value: 'map', label: 'Map' },
    { value: 'ar', label: 'AR' },
  ];
  return (
    <View style={styles.tabs} accessibilityRole="tablist">
      {items.map((it) => {
        const on = it.value === value;
        return (
          <Pressable
            key={it.value}
            onPress={() => onChange(it.value)}
            style={styles.tab}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            hitSlop={6}
          >
            <Text style={[styles.tabText, on && styles.tabTextOn]}>{it.label}</Text>
            <View style={[styles.tabRule, on && styles.tabRuleOn]} />
          </Pressable>
        );
      })}
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bg },
    top: { position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: 16, gap: 8 },
    topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 },
    tabs: {
      flexDirection: 'row',
      gap: 22,
      height: 46,
      paddingHorizontal: 20,
      alignItems: 'center',
      backgroundColor: c.glass,
      borderRadius: radii.card,
      borderWidth: 1,
      borderColor: c.line,
    },
    tab: { alignItems: 'center', paddingTop: 4 },
    tabText: { fontFamily: fonts.caps, fontSize: 18, color: c.muted },
    tabTextOn: { color: c.text },
    tabRule: { marginTop: 3, height: 2, width: '100%', borderRadius: 1, backgroundColor: 'transparent' },
    tabRuleOn: { backgroundColor: c.accent },
    square: {
      width: 46,
      height: 46,
      borderRadius: radii.card,
      backgroundColor: c.glass,
      borderWidth: 1,
      borderColor: c.line,
      alignItems: 'center',
      justifyContent: 'center',
    },
    squarePressed: { backgroundColor: c.surfaceHi },
    banner: { backgroundColor: c.button, borderRadius: radii.control, padding: 12 },
    bannerText: { fontFamily: fonts.sansSemi, color: c.onButton, fontSize: 14, lineHeight: 19 },
    bottom: { position: 'absolute', bottom: 0, left: 0, right: 0, paddingHorizontal: 16, paddingBottom: 8, gap: 10 },
    sliderCard: {
      backgroundColor: c.glass,
      borderRadius: radii.card,
      paddingHorizontal: 18,
      paddingTop: 14,
      paddingBottom: 6,
      borderWidth: 1,
      borderColor: c.line,
    },
  });
