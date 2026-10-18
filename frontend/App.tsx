import {
  Archivo_400Regular,
  Archivo_600SemiBold,
  Archivo_700Bold,
  Archivo_800ExtraBold,
  useFonts,
} from "@expo-google-fonts/archivo";
import { StatusBar as SystemStatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import {
  SafeAreaProvider,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import { NearbySheet } from "./src/components/NearbySheet";
import { StartupAnimation } from "./src/components/StartupAnimation";
import { CompassBadge, TAB_BAR_H, TabBar, type Tab } from "./src/components/ui";
import { useMapCameras } from "./src/cameraList";
import { ARScreen } from "./src/screens/ARScreen";
import { ClassifyScreen } from "./src/screens/ClassifyScreen";
import { MapScreen } from "./src/screens/MapScreen";
import { FaqScreen } from "./src/screens/FaqScreen";
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
import type { BackendStatus } from "./src/types";

const TOP_BAR_H = 40;

// Startup: an animated version of the logo (src/components/StartupAnimation.tsx) plays while fonts and
// settings load, then fades into the app.
const LOADING_BG = "#151627";

export default function App() {
  const [fontsLoaded] = useFonts({
    Archivo_400Regular,
    Archivo_600SemiBold,
    Archivo_700Bold,
    Archivo_800ExtraBold,
  });
  return (
    <SafeAreaProvider>
      <SettingsProvider>
        <ThemeProvider>
          <Root fontsLoaded={fontsLoaded} />
        </ThemeProvider>
      </SettingsProvider>
    </SafeAreaProvider>
  );
}

function Root({ fontsLoaded }: { fontsLoaded: boolean }) {
  const settings = useSettings();
  const appReady = fontsLoaded && settings.loaded;
  const [introPlayed, setIntroPlayed] = useState(false); // logo finished animating
  const [introDone, setIntroDone] = useState(false); // intro faded out
  return (
    <View style={{ flex: 1, backgroundColor: LOADING_BG }}>
      {/* The app mounts underneath once the logo has played, so the intro can fade straight into it. */}
      {appReady && introPlayed && <Main />}
      {!introDone && (
        <StartupAnimation
          appReady={appReady}
          fontsLoaded={fontsLoaded}
          onPlayed={() => setIntroPlayed(true)}
          onDone={() => setIntroDone(true)}
        />
      )}
    </View>
  );
}

function Main() {
  const settings = useSettings();
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const { position, heading, permission, snapshot } = useTelemetry();
  const [backend, setBackend] = useState<BackendStatus>("off");
  const [sheetHeight, setSheetHeight] = useState(320);
  // Tabs: Map and Camera are remembered between launches (settings.view); FAQ and Settings are just screens.
  const [tab, setTab] = useState<Tab>(settings.view);
  // FAQ and Settings are plain scrolling pages: no compass or location banner floating over them.
  const fullPage = tab === "faq" || tab === "settings";
  const goTo = (t: Tab) => {
    setTab(t);
    // Only the Map and Camera tabs are remembered between launches (settings.view is a ViewMode).
    if ((t === "map" || t === "ar") && t !== settings.view)
      settings.update({ view: t });
  };

  const topBarTop = insets.top + 8;
  const belowTopBar = topBarTop + TOP_BAR_H;
  const tabBarH = TAB_BAR_H + insets.bottom;

  // Map view: the same /cameras/list cache as the Camera tab (every 30 s walking / 5 s driving).
  // Distances update from live GPS on the phone; only cameras inside the radius are shown.
  const map = useMapCameras(
    tab === "map",
    settings.apiUrl,
    position,
    settings.radius,
    settings.mode,
  );
  const cameras = map.cameras;

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
            backend={map.status}
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
      {tab === "classify" && (
        <ClassifyScreen
          snapshot={snapshot}
          topInset={belowTopBar}
          bottomInset={tabBarH}
        />
      )}
      {tab === "faq" && <FaqScreen bottomInset={tabBarH} />}
      {tab === "settings" && <SettingsScreen bottomInset={tabBarH} />}

      {/* Compass, top right, on the Map and Camera tabs */}
      {!fullPage && (
        <View
          style={[styles.topBar, { top: topBarTop }]}
          pointerEvents="box-none"
        >
          <CompassBadge heading={heading} />
        </View>
      )}

      {permission === "denied" && !fullPage && (
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
    root: { flex: 1, backgroundColor: c.surface },
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
      backgroundColor: c.errorContainer,
      borderRadius: radii.tile,
      borderWidth: BORDER,
      borderColor: c.errorContainer,
      padding: 12,
    },
    bannerText: {
      fontFamily: fonts.sansBold,
      color: c.onErrorContainer,
      fontSize: 14,
      lineHeight: 19,
    },
  });
