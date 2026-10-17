import { Fragment, useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import MapView, { Circle, Marker, Polygon } from 'react-native-maps';
import { UTD_CENTER } from '../config';
import { formatDistance } from '../geo';
import { useSettings } from '../settings';
import { colors } from '../theme';
import type { Camera, LatLng } from '../types';

/** Draws exactly what the backend returned: no distance or filtering math on the phone. */
export function MapScreen({ position, cameras }: { position: LatLng | null; cameras: Camera[] }) {
  const { radius, units } = useSettings();
  const mapRef = useRef<MapView>(null);
  const center = position ?? UTD_CENTER;

  // Keep the radius circle in view (camera zoom only).
  useEffect(() => {
    const delta = (radius * 2.4) / 111_320;
    mapRef.current?.animateToRegion({ ...center, latitudeDelta: delta, longitudeDelta: delta * 1.2 }, 400);
  }, [radius, center.latitude, center.longitude]);

  return (
    <View style={StyleSheet.absoluteFill}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        initialRegion={{ ...UTD_CENTER, latitudeDelta: 0.04, longitudeDelta: 0.05 }}
        showsUserLocation
        showsCompass
        userInterfaceStyle="dark"
      >
        <Circle center={center} radius={radius} fillColor={colors.radiusFill} strokeColor={colors.radiusStroke} strokeWidth={2} />

        {cameras.map((c) => (
          <Fragment key={c.id}>
            {c.cone && c.cone.length > 2 && (
              <Polygon coordinates={c.cone} fillColor={colors.cone} strokeColor={colors.coneStroke} strokeWidth={1} />
            )}
            <Marker
              coordinate={c}
              pinColor={c.alert ? colors.alert : colors.warn}
              title={c.name ?? 'ALPR camera'}
              description={c.distance_m != null ? `${formatDistance(c.distance_m, units)} away` : undefined}
            />
          </Fragment>
        ))}
      </MapView>
    </View>
  );
}
