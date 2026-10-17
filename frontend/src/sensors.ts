import * as Location from 'expo-location';
import { DeviceMotion, Magnetometer, type DeviceMotionMeasurement } from 'expo-sensors';
import { useEffect, useRef, useState } from 'react';
import type { LatLng } from './types';

/**
 * Raw phone telemetry, passed to the backend as-is. No processing happens on the phone.
 *
 * location       full GPS fix: latitude, longitude, altitude, accuracy, heading (course), speed
 * compass        expo-location heading: magHeading, trueHeading (degrees), accuracy
 * motion         expo-sensors DeviceMotion:
 *                  rotation {alpha, beta, gamma}            device orientation, radians
 *                  rotationRate {alpha, beta, gamma}        gyroscope, deg/s
 *                  acceleration {x, y, z}                   m/s², gravity removed
 *                  accelerationIncludingGravity {x, y, z}   m/s²
 *                  orientation                              screen orientation: 0, 90, -90, 180
 * magnetometer   raw magnetic field {x, y, z}, μT
 */
export type Telemetry = {
  location: Location.LocationObjectCoords | null;
  locationTimestamp: number | null;
  compass: Location.LocationHeadingObject | null;
  motion: DeviceMotionMeasurement | null;
  magnetometer: { x: number; y: number; z: number; timestamp: number } | null;
};

const SENSOR_INTERVAL_MS = 100;

/**
 * Starts every sensor once and keeps the latest readings in a ref.
 * `snapshot()` returns them for the frame upload; `position` is React state for the map.
 */
export function useTelemetry() {
  const latest = useRef<Telemetry>({ location: null, locationTimestamp: null, compass: null, motion: null, magnetometer: null });
  const [position, setPosition] = useState<LatLng | null>(null);
  const [permission, setPermission] = useState<'unknown' | 'granted' | 'denied'>('unknown');

  useEffect(() => {
    const subs: { remove: () => void }[] = [];
    let cancelled = false;

    (async () => {
      const loc = await Location.requestForegroundPermissionsAsync();
      if (cancelled) return;
      setPermission(loc.status === 'granted' ? 'granted' : 'denied');

      if (loc.status === 'granted') {
        subs.push(
          await Location.watchPositionAsync(
            { accuracy: Location.Accuracy.BestForNavigation, distanceInterval: 1, timeInterval: 1000 },
            (l) => {
              latest.current.location = l.coords;
              latest.current.locationTimestamp = l.timestamp;
              setPosition({ latitude: l.coords.latitude, longitude: l.coords.longitude });
            },
          ),
        );
        subs.push(await Location.watchHeadingAsync((h) => (latest.current.compass = h)));
      }

      if (await DeviceMotion.isAvailableAsync()) {
        await DeviceMotion.requestPermissionsAsync().catch(() => {});
        DeviceMotion.setUpdateInterval(SENSOR_INTERVAL_MS);
        subs.push(DeviceMotion.addListener((m) => (latest.current.motion = m)));
      }

      if (await Magnetometer.isAvailableAsync()) {
        Magnetometer.setUpdateInterval(SENSOR_INTERVAL_MS);
        subs.push(Magnetometer.addListener((m) => (latest.current.magnetometer = m)));
      }
    })().catch(() => setPermission('denied'));

    return () => {
      cancelled = true;
      subs.forEach((s) => s.remove());
    };
  }, []);

  /** Copy of the latest readings, safe to serialize. */
  const snapshot = (): Telemetry => JSON.parse(JSON.stringify(latest.current));

  return { position, permission, snapshot };
}
