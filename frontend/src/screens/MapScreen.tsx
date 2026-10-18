import { Feather } from '@expo/vector-icons';
import { Fragment, useEffect, useRef } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import MapView, { Circle, Marker, Polygon } from 'react-native-maps';
import { IconButton } from '../components/ui';
import { UTD_CENTER } from '../config';
import { formatDistance } from '../geo';
import { useSettings } from '../settings';
import { BORDER, useColors, useThemedStyles, type Palette } from '../theme';
import type { Camera, LatLng } from '../types';

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

  const fitRadius = () => {
    const delta = (radius * 2.6) / 111_320;
    mapRef.current?.animateToRegion({ ...center, latitudeDelta: delta, longitudeDelta: delta * 1.2 }, 400);
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
    if (cam.altitude != null && Platform.OS === 'ios') {
      mapRef.current?.animateCamera({ altitude: cam.altitude * (inward ? 0.5 : 2) }, { duration: 250 });
    } else if (cam.zoom != null) {
      mapRef.current?.animateCamera({ zoom: cam.zoom + (inward ? 1 : -1) }, { duration: 250 });
    }
  };

  return (
    <View style={StyleSheet.absoluteFill}>
      <MapView
        key={colors.scheme} // remount so Android picks up the new map style
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        initialRegion={{ ...center, latitudeDelta: (radius * 2.6) / 111_320, longitudeDelta: (radius * 3.1) / 111_320 }}
        showsUserLocation
        showsMyLocationButton={false}
        showsCompass={false}
        showsPointsOfInterests={false}
        toolbarEnabled={false}
        userInterfaceStyle={colors.scheme}
        mapType={Platform.OS === 'ios' ? 'mutedStandard' : 'standard'}
        customMapStyle={Platform.OS === 'android' ? (colors.scheme === 'dark' ? STORYBOOK_DARK : STORYBOOK_LIGHT) : undefined}
      >
        <Circle
          center={center}
          radius={radius}
          fillColor={colors.radiusFill}
          strokeColor={colors.radiusStroke}
          strokeWidth={2}
        />

        {cameras.map((c, i) => {
          const hot = i === 0 || !!c.alert;
          return (
            <Fragment key={c.id}>
              {c.cone && c.cone.length > 2 && (
                <Polygon
                  coordinates={c.cone}
                  fillColor={colors.cone}
                  strokeColor={colors.coneStroke}
                  strokeWidth={1.5}
                />
              )}
              <Marker
                coordinate={c}
                title={c.name ?? 'License plate camera'}
                description={c.distance_m != null ? `${formatDistance(c.distance_m, units)} from you` : undefined}
                anchor={{ x: 0.5, y: 0.5 }}
                tracksViewChanges={false}
              >
                <View style={[styles.marker, hot && styles.markerHot]}>
                  <Feather name="video" size={16} color={hot ? colors.onAlert : colors.alert} />
                </View>
              </Marker>
            </Fragment>
          );
        })}
      </MapView>

      <View style={[styles.controls, { top: controlsTop }]}>
        <View style={styles.zoomStack}>
          <IconButton icon="plus" label="Zoom in" size={44} onPress={() => zoom(true)} />
          <IconButton icon="minus" label="Zoom out" size={44} onPress={() => zoom(false)} />
        </View>
      </View>
      <View style={[styles.recenter, { bottom: recenterBottom }]}>
        <IconButton icon="navigation" label="My location" showLabel size={44} tone="primary" onPress={fitRadius} />
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
      backgroundColor: c.surface,
      borderWidth: BORDER,
      borderColor: c.outline,
      alignItems: 'center',
      justifyContent: 'center',
    },
    markerHot: { backgroundColor: c.alert },
    controls: { position: 'absolute', right: 16, alignItems: 'center' },
    zoomStack: { gap: 8 },
    recenter: { position: 'absolute', right: 16 },
  });

// Google Maps styles (Android) built from tints/shades of indigo and cream: quiet cream land, pale roads, muted water.
const STORYBOOK_LIGHT = [
  { elementType: 'geometry', stylers: [{ color: '#F2F0E3' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#636575' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#EEEBDA' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi.park', stylers: [{ visibility: 'on' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#D0CEC4' }] },
  { featureType: 'poi.park', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'road', elementType: 'geometry.fill', stylers: [{ color: '#F8F7F0' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#C6C5BD' }] },
  { featureType: 'road.highway', elementType: 'geometry.fill', stylers: [{ color: '#DEDCCE' }] },
  { featureType: 'landscape.man_made', elementType: 'geometry', stylers: [{ color: '#E4E1D3' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#B7B5B2' }] },
];

const STORYBOOK_DARK = [
  { elementType: 'geometry', stylers: [{ color: '#303350' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#B3B1AF' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#282B4A' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi.park', stylers: [{ visibility: 'on' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#40425B' }] },
  { featureType: 'poi.park', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'road', elementType: 'geometry.fill', stylers: [{ color: '#464860' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#282B4A' }] },
  { featureType: 'road.highway', elementType: 'geometry.fill', stylers: [{ color: '#58596D' }] },
  { featureType: 'landscape.man_made', elementType: 'geometry', stylers: [{ color: '#363854' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#1C1E34' }] },
];
