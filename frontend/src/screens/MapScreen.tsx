import { Fragment, useEffect, useRef } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import MapView, { Circle, Marker, Polygon } from 'react-native-maps';
import { UTD_CENTER } from '../config';
import { formatDistance } from '../geo';
import { useSettings } from '../settings';
import { fonts, useColors, useThemedStyles, type Palette } from '../theme';
import type { Camera, LatLng } from '../types';

/**
 * Draws exactly what the backend returned: no distance or filtering math on the phone.
 * The backend sorts nearest-first, so pin numbers are distance rank: 01 is the closest.
 */
export function MapScreen({ position, cameras }: { position: LatLng | null; cameras: Camera[] }) {
  const { radius, units } = useSettings();
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);
  const mapRef = useRef<MapView>(null);
  const center = position ?? UTD_CENTER;

  // Zoom to fit the radius only when the radius itself changes.
  useEffect(() => {
    const delta = (radius * 2.4) / 111_320;
    mapRef.current?.animateToRegion({ ...center, latitudeDelta: delta, longitudeDelta: delta * 1.2 }, 400);
  }, [radius]);

  // On GPS updates, just follow the phone. Keep whatever zoom the user chose.
  useEffect(() => {
    mapRef.current?.animateCamera({ center }, { duration: 400 });
  }, [center.latitude, center.longitude]);

  return (
    <View style={StyleSheet.absoluteFill}>
      <MapView
        key={colors.scheme} // remount so Android picks up the new map style
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        initialRegion={{ ...center, latitudeDelta: (radius * 2.4) / 111_320, longitudeDelta: (radius * 2.9) / 111_320 }}
        showsUserLocation
        showsMyLocationButton={false}
        showsCompass={false}
        showsPointsOfInterests={false}
        toolbarEnabled={false}
        userInterfaceStyle={colors.scheme}
        mapType={Platform.OS === 'ios' ? 'mutedStandard' : 'standard'}
        customMapStyle={Platform.OS === 'android' ? (colors.scheme === 'dark' ? ENGRAVED_DARK : ENGRAVED_LIGHT) : undefined}
      >
        <Circle center={center} radius={radius} fillColor={colors.radiusFill} strokeColor={colors.radiusStroke} strokeWidth={2} />

        {cameras.map((c, i) => {
          const nearest = i === 0;
          return (
            <Fragment key={c.id}>
              {c.cone && c.cone.length > 2 && (
                <Polygon coordinates={c.cone} fillColor={colors.cone} strokeColor={colors.coneStroke} strokeWidth={1} />
              )}
              <Marker
                coordinate={c}
                title={c.name ?? 'License plate camera'}
                description={c.distance_m != null ? `${formatDistance(c.distance_m, units)} away` : undefined}
                anchor={{ x: 0.5, y: 0.5 }}
                tracksViewChanges={false}
              >
                {nearest ? (
                  <View style={[styles.nearest, c.alert && { backgroundColor: colors.alert }]}>
                    <View style={styles.nearestCore} />
                  </View>
                ) : (
                  <View style={[styles.pin, c.alert && { backgroundColor: colors.alert }]}>
                    <Text style={styles.pinText}>{String(i + 1).padStart(2, '0')}</Text>
                  </View>
                )}
              </Marker>
            </Fragment>
          );
        })}
      </MapView>

      {/* Sepia wash so the base map reads as an old printed map, not a stock one. */}
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: colors.mapTint }]} />
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    pin: {
      width: 26,
      height: 26,
      borderRadius: 13,
      backgroundColor: c.teal,
      borderWidth: 1.5,
      borderColor: c.scheme === 'dark' ? '#EFE4D6' : '#FBF5EC',
      alignItems: 'center',
      justifyContent: 'center',
    },
    pinText: { fontFamily: fonts.sansBold, fontSize: 10, color: '#FBF5EC' },
    nearest: {
      width: 30,
      height: 30,
      borderRadius: 15,
      backgroundColor: c.accent,
      borderWidth: 2,
      borderColor: c.scheme === 'dark' ? '#EFE4D6' : '#FBF5EC',
      alignItems: 'center',
      justifyContent: 'center',
    },
    nearestCore: { width: 8, height: 8, borderRadius: 4, borderWidth: 2, borderColor: '#FBF5EC' },
  });

// Google Maps styles (Android): sepia engraving, POIs off, roads as fine lines.
const ENGRAVED_DARK = [
  { elementType: 'geometry', stylers: [{ color: '#241e1a' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#a8998a' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#1f1a16' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#3a312b' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#1f1a16' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#4a3f37' }] },
  { featureType: 'landscape.man_made', elementType: 'geometry', stylers: [{ color: '#2c2520' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#171310' }] },
];

const ENGRAVED_LIGHT = [
  { elementType: 'geometry', stylers: [{ color: '#efe4d3' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#76665a' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#f3eadc' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#fbf5ec' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#d8c9b5' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#f1d9bf' }] },
  { featureType: 'landscape.man_made', elementType: 'geometry', stylers: [{ color: '#e6d8c4' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#cfd9d2' }] },
];
