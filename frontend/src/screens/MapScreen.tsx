import { Feather } from "@expo/vector-icons";
import { Fragment, useEffect, useRef, useState } from "react";
import { Platform, StyleSheet, View } from "react-native";
import MapView, { Circle, Marker, Polygon } from "react-native-maps";
import { IconButton } from "../components/ui";
import { CAMERA_FOV_DEG, CAMERA_FOV_RANGE_M, UTD_CENTER } from "../config";
import { formatDistance, fovPolygon } from "../geo";
import { useSettings } from "../settings";
import { BORDER, useColors, useThemedStyles, withAlpha, type Palette } from "../theme";
import type { Camera, LatLng } from "../types";

// The marker's size at the radius-fit zoom; the actual box scales with the zoom (see markerSize).
const MARKER_BASE_SIZE = 34;

/**
 * Draws exactly what the backend returned: no distance or filtering math on the phone.
 * The backend sorts nearest-first, so cameras[0] gets the red "nearest" marker.
 */
export function MapScreen({
  position,
  cameras,
  controlsTop,
  recenterBottom,
}: {
  position: LatLng | null;
  cameras: Camera[];
  controlsTop: number; // where the zoom controls sit (below the top bar)
  recenterBottom: number; // where "center on me" sits (above the bottom sheet)
}) {
  const { radius, units } = useSettings();
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);
  const mapRef = useRef<MapView>(null);
  const center = position ?? UTD_CENTER;

  // The span of latitude currently on screen. Small = zoomed in, large = zoomed out.
  // We scale the camera markers off this so they grow and shrink with the zoom, like the
  // field-of-view cones (which are geographic and scale on their own).
  const fitDelta = (radius * 2.6) / 111_320;
  const [latDelta, setLatDelta] = useState(fitDelta);
  // react-native-maps only redraws a marker's view while tracksViewChanges is true, which is
  // expensive to leave on. Turn it on briefly whenever the zoom settles, then back off.
  const [tracking, setTracking] = useState(true);
  useEffect(() => {
    setTracking(true);
    const t = setTimeout(() => setTracking(false), 400);
    return () => clearTimeout(t);
  }, [latDelta]);

  // scale = 1 at the radius-fit zoom; clamped so markers never vanish or swamp the map.
  // Drives the marker's real layout size (not a transform — a transform fights the native
  // anchor snapshot and the marker drifts off its coordinate).
  const markerScale = Math.max(0.7, Math.min(0.75, fitDelta / latDelta));
  const markerSize = Math.round(MARKER_BASE_SIZE * markerScale);
  const markerIconSize = Math.round(markerSize * (16 / MARKER_BASE_SIZE));

  const fitRadius = () => {
    mapRef.current?.animateToRegion(
      { ...center, latitudeDelta: fitDelta, longitudeDelta: fitDelta * 1.2 },
      400,
    );
  };

  // Zoom to fit the radius only when the radius itself changes.
  useEffect(fitRadius, [radius]);

  // On GPS updates, just follow the phone. Keep whatever zoom the user chose.
  useEffect(() => {
    mapRef.current?.animateCamera({ center }, { duration: 400 });
  }, [center.latitude, center.longitude]);

  // Apple Maps zooms by altitude, Google Maps by zoom level.
  const zoom = async (inward: boolean) => {
    const cam = await mapRef.current?.getCamera();
    if (!cam) return;
    if (cam.altitude != null && Platform.OS === "ios") {
      mapRef.current?.animateCamera(
        { altitude: cam.altitude * (inward ? 0.5 : 2) },
        { duration: 250 },
      );
    } else if (cam.zoom != null) {
      mapRef.current?.animateCamera(
        { zoom: cam.zoom + (inward ? 1 : -1) },
        { duration: 250 },
      );
    }
  };

  return (
    <View style={StyleSheet.absoluteFill}>
      <MapView
        key={colors.scheme} // remount so Android picks up the new map style
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        initialRegion={{
          ...center,
          latitudeDelta: (radius * 2.6) / 111_320,
          longitudeDelta: (radius * 3.1) / 111_320,
        }}
        showsUserLocation
        showsMyLocationButton={false}
        showsCompass={false}
        showsPointsOfInterests={false}
        toolbarEnabled={false}
        userInterfaceStyle={colors.scheme}
        onRegionChangeComplete={(r) => setLatDelta(r.latitudeDelta)}
        mapType={Platform.OS === "ios" ? "mutedStandard" : "standard"}
        customMapStyle={
          Platform.OS === "android"
            ? colors.scheme === "dark"
              ? STORYBOOK_DARK
              : STORYBOOK_LIGHT
            : undefined
        }
      >
        <Circle
          center={center}
          radius={radius}
          fillColor={withAlpha(colors.primary, 0.1)}
          strokeColor={colors.primary}
          strokeWidth={2}
        />

        {cameras.map((c, i) => {
          const hot = i === 0 || !!c.alert;
          // Field-of-view wedge from the camera's stored heading (opening angle set internally).
          // Fall back to a backend-supplied polygon if one is present and there's no heading.
          const cone =
            c.heading != null
              ? fovPolygon(c.latitude, c.longitude, c.heading, CAMERA_FOV_DEG, CAMERA_FOV_RANGE_M)
              : c.cone;
          return (
            <Fragment key={c.id}>
              {cone && cone.length > 2 && (
                <Polygon
                  coordinates={cone}
                  fillColor={withAlpha(colors.onSurface, 0.18)}
                  strokeColor={colors.onSurfaceVariant}
                  strokeWidth={1.5}
                />
              )}
              <Marker
                coordinate={c}
                title={c.name ?? "License plate camera"}
                description={
                  c.distance_m != null
                    ? `${formatDistance(c.distance_m, units)} from you`
                    : undefined
                }
                anchor={{ x: 0.5, y: 0.5 }}
                tracksViewChanges={tracking}
              >
                <View
                  style={[
                    styles.marker,
                    hot && styles.markerHot,
                    {
                      width: markerSize,
                      height: markerSize,
                      borderRadius: markerSize * 0.18,
                    },
                  ]}
                >
                  <Feather
                    name="video"
                    size={markerIconSize}
                    color={hot ? colors.onAlert : colors.primary}
                  />
                </View>
              </Marker>
            </Fragment>
          );
        })}
      </MapView>

      <View style={[styles.controls, { top: controlsTop }]}>
        <View style={styles.zoomStack}>
          <IconButton
            icon="plus"
            label="Zoom in"
            size={44}
            onPress={() => zoom(true)}
          />
          <IconButton
            icon="minus"
            label="Zoom out"
            size={44}
            onPress={() => zoom(false)}
          />
        </View>
      </View>
      <View style={[styles.recenter, { bottom: recenterBottom }]}>
        <IconButton
          icon="navigation"
          label="My location"
          showLabel
          size={44}
          tone="primary"
          onPress={fitRadius}
        />
      </View>
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    marker: {
      width: 34,
      height: 34,
      borderRadius: 6,
      backgroundColor: c.surfaceContainerHigh,
      borderWidth: BORDER,
      borderColor: c.outline,
      alignItems: "center",
      justifyContent: "center",
    },
    markerHot: { backgroundColor: c.alert, borderColor: c.alert },
    controls: { position: "absolute", right: 16, alignItems: "center" },
    zoomStack: { gap: 8 },
    recenter: { position: "absolute", right: 16 },
  });

// Google Maps styles (Android) built from the M3 neutral / neutral-variant tonal palettes (tone noted per
// value), so the map sits on the same surfaces as the UI: quiet land, bright roads, muted water.
const STORYBOOK_LIGHT = [
  { elementType: "geometry", stylers: [{ color: "#F6F2F6" }] }, // N96
  { elementType: "labels.text.fill", stylers: [{ color: "#46464E" }] }, // NV30
  { elementType: "labels.text.stroke", stylers: [{ color: "#FCF8FB" }] }, // N98
  { featureType: "poi", stylers: [{ visibility: "off" }] },
  { featureType: "poi.park", stylers: [{ visibility: "on" }] },
  {
    featureType: "poi.park",
    elementType: "geometry",
    stylers: [{ color: "#E5E1E5" }], // N90
  },
  {
    featureType: "poi.park",
    elementType: "labels",
    stylers: [{ visibility: "off" }],
  },
  { featureType: "transit", stylers: [{ visibility: "off" }] },
  {
    featureType: "road",
    elementType: "geometry.fill",
    stylers: [{ color: "#FFFFFF" }], // N100
  },
  {
    featureType: "road",
    elementType: "geometry.stroke",
    stylers: [{ color: "#C7C5CE" }], // NV80
  },
  {
    featureType: "road.highway",
    elementType: "geometry.fill",
    stylers: [{ color: "#EAE7EA" }], // N92
  },
  {
    featureType: "landscape.man_made",
    elementType: "geometry",
    stylers: [{ color: "#F0EDF0" }], // N94
  },
  {
    featureType: "water",
    elementType: "geometry",
    stylers: [{ color: "#ACAAB3" }], // NV70
  },
];

const STORYBOOK_DARK = [
  { elementType: "geometry", stylers: [{ color: "#201F22" }] }, // N12
  { elementType: "labels.text.fill", stylers: [{ color: "#C7C5CE" }] }, // NV80
  { elementType: "labels.text.stroke", stylers: [{ color: "#131315" }] }, // N6
  { featureType: "poi", stylers: [{ visibility: "off" }] },
  { featureType: "poi.park", stylers: [{ visibility: "on" }] },
  {
    featureType: "poi.park",
    elementType: "geometry",
    stylers: [{ color: "#2A2A2C" }], // N17
  },
  {
    featureType: "poi.park",
    elementType: "labels",
    stylers: [{ visibility: "off" }],
  },
  { featureType: "transit", stylers: [{ visibility: "off" }] },
  {
    featureType: "road",
    elementType: "geometry.fill",
    stylers: [{ color: "#353437" }], // N22
  },
  {
    featureType: "road",
    elementType: "geometry.stroke",
    stylers: [{ color: "#131315" }], // N6
  },
  {
    featureType: "road.highway",
    elementType: "geometry.fill",
    stylers: [{ color: "#474649" }], // N30
  },
  {
    featureType: "landscape.man_made",
    elementType: "geometry",
    stylers: [{ color: "#1C1B1E" }], // N10
  },
  {
    featureType: "water",
    elementType: "geometry",
    stylers: [{ color: "#0E0E10" }], // N4
  },
];
