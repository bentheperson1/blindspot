import {
  Archivo_400Regular,
  Archivo_600SemiBold,
  Archivo_700Bold,
  Archivo_800ExtraBold,
  useFonts,
} from "@expo-google-fonts/archivo";
import { StatusBar as SystemStatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import {
  Image,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import {
  SafeAreaProvider,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import { checkHealth, fetchCameras } from "./src/api";
import { NearbySheet } from "./src/components/NearbySheet";
import { CompassBadge, TAB_BAR_H, TabBar, type Tab } from "./src/components/ui";
import { CAMERA_REFRESH_MS } from "./src/config";
import { ARScreen } from "./src/screens/ARScreen";
import { MapScreen } from "./src/screens/MapScreen";
import { SettingsScreen } from "./src/screens/SettingsScreen";
import { useTelemetry } from "./src/sensors";
import { SettingsProvider, useSettings } from "./src/settings";
import {
  BORDER,
  fonts,
  radii,
  ThemeProvider,
  useColors,
  useThemedStyles,
  type Palette,
} from "./src/theme";
import type { BackendStatus, Camera } from "./src/types";

const TOP_BAR_H = 40;

// Loading screen: the blindspot logo on its own navy, shown for at least this long while fonts and settings load.
const LOADING_MIN_MS = 1500;
const LOADING_BG = "#151627"; // the logo's background, so the image edges disappear
const LOGO = require("./assets/logo.png");

function LoadingScreen() {
  const { width, height } = useWindowDimensions();
  const size = Math.min(width, height);
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: LOADING_BG,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Image
        source={LOGO}
        style={{ width: size, height: size }}
        resizeMode="contain"
        accessible
        accessibilityLabel="blindspot"
      />
    </View>
  );
}

export default function App() {
  const [fontsLoaded] = useFonts({
    Archivo_400Regular,
    Archivo_600SemiBold,
    Archivo_700Bold,
    Archivo_800ExtraBold,
  });
  const [minTimeDone, setMinTimeDone] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setMinTimeDone(true), LOADING_MIN_MS);
    return () => clearTimeout(t);
  }, []);
  return (
    <SafeAreaProvider>
      <SettingsProvider>
        <ThemeProvider>
          <Root ready={fontsLoaded && minTimeDone} />
        </ThemeProvider>
      </SettingsProvider>
    </SafeAreaProvider>
  );
}

function Root({ ready }: { ready: boolean }) {
  const settings = useSettings();
  if (!ready || !settings.loaded) return <LoadingScreen />;
  return <Main />;
}

function Main() {
  const settings = useSettings();
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const { position, heading, permission, snapshot } = useTelemetry();
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [backend, setBackend] = useState<BackendStatus>("off");
  const [sheetHeight, setSheetHeight] = useState(320);
  // Tabs: Map and Camera are remembered between launches (settings.view); Settings is just a screen.
  const [tab, setTab] = useState<Tab>(settings.view);
  const goTo = (t: Tab) => {
    setTab(t);
    if (t !== "settings" && t !== settings.view) settings.update({ view: t });
  };

  const topBarTop = insets.top + 8;
  const belowTopBar = topBarTop + TOP_BAR_H;
  const tabBarH = TAB_BAR_H + insets.bottom;

  // Map view: ask the backend which cameras are near the phone. It filters, sorts and flags alerts.
  useEffect(() => {
    if (tab !== "map" || !position) return;
    let cancelled = false;
    const load = async () => {
      const [alive, cams] = await Promise.all([
        checkHealth(settings.apiUrl),
        fetchCameras(settings.apiUrl, {
          lat: position.latitude,
          lon: position.longitude,
          radius_m: settings.radius,
          mode: settings.mode,
        }),
      ]);
      if (cancelled) return;
      setBackend(alive ? "ok" : "error");
      setCameras(cams);
    };
    load();
    const t = setInterval(load, CAMERA_REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [
    tab,
    settings.apiUrl,
    settings.radius,
    settings.mode,
    position?.latitude,
    position?.longitude,
  ]);

  return (
    <View style={styles.root}>
      <SystemStatusBar style={colors.scheme === "dark" ? "light" : "dark"} />

      {tab === "map" && (
        <>
          <MapScreen
            position={position}
            cameras={cameras}
            controlsTop={belowTopBar + 12}
            recenterBottom={tabBarH + sheetHeight + 12}
          />
          <NearbySheet
            cameras={cameras}
            backend={backend}
            bottom={tabBarH}
            onLookAround={() => goTo("ar")}
            onLayoutHeight={setSheetHeight}
          />
        </>
      )}
      {tab === "ar" && (
        <ARScreen
          snapshot={snapshot}
          onBackendStatus={setBackend}
          topInset={belowTopBar}
          bottomInset={tabBarH}
        />
      )}
      {tab === "settings" && <SettingsScreen bottomInset={tabBarH} />}

      {/* Compass, top right, on the Map and Camera tabs */}
      {tab !== "settings" && (
        <View
          style={[styles.topBar, { top: topBarTop }]}
          pointerEvents="box-none"
        >
          <CompassBadge heading={heading} />
        </View>
      )}

      {permission === "denied" && tab !== "settings" && (
        <View style={[styles.banner, { top: belowTopBar + 12 }]}>
          <Text style={styles.bannerText}>
            Location is off. Turn it on in your phone's settings so the server
            knows where you are.
          </Text>
        </View>
      )}

      <TabBar value={tab} onChange={goTo} />
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: c.paper },
    topBar: {
      position: "absolute",
      left: 16,
      right: 16,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "flex-end",
    },
    banner: {
      position: "absolute",
      left: 16,
      right: 72,
      backgroundColor: c.surface,
      borderRadius: radii.tile,
      borderWidth: BORDER,
      borderColor: c.outline,
      padding: 12,
    },
    bannerText: {
      fontFamily: fonts.sansBold,
      color: c.ink,
      fontSize: 14,
      lineHeight: 19,
    },
  });
