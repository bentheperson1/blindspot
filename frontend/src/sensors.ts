import * as Location from 'expo-location';
import { DeviceMotion, Magnetometer, type DeviceMotionMeasurement } from 'expo-sensors';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { LatLng } from './types';

/** (keep your original doc comment here) */
export type Telemetry = {
  location: Location.LocationObjectCoords | null;
  locationTimestamp: number | null;
  compass: Location.LocationHeadingObject | null;
  motion: DeviceMotionMeasurement | null;
  magnetometer: { x: number; y: number; z: number; timestamp: number } | null;
};

const SENSOR_INTERVAL_MS = 100;

export function useTelemetry() {
  const latest = useRef<Telemetry>({ location: null, locationTimestamp: null, compass: null, motion: null, magnetometer: null });
  const [position, setPosition] = useState<LatLng | null>(null);
  const [permission, setPermission] = useState<'unknown' | 'granted' | 'denied'>('unknown');

  useEffect(() => {
    const subs: { remove: () => void }[] = [];
    let cancelled = false;

    // if cleanup already ran while an await was pending, remove the subscription immediately
    const track = (sub: { remove: () => void }) => {
      if (cancelled) {
        sub.remove();
      } else {
        subs.push(sub);
      }
    };

    const applyFix = (l: Location.LocationObject) => {
      latest.current.location = l.coords;
      latest.current.locationTimestamp = Math.round(l.timestamp);
      setPosition({ latitude: l.coords.latitude, longitude: l.coords.longitude });
    };

    (async () => {
      const loc = await Location.requestForegroundPermissionsAsync();
      if (cancelled) return;
      setPermission(loc.status === 'granted' ? 'granted' : 'denied');

      if (loc.status === 'granted') {
        // seed so the first frames aren't sent with location: null
        const last = await Location.getLastKnownPositionAsync().catch(() => null);
        if (cancelled) return;
        if (last) applyFix(last);

        track(
          await Location.watchPositionAsync(
            { accuracy: Location.Accuracy.BestForNavigation, distanceInterval: 0, timeInterval: 1000 },
            applyFix,
          ),
        );
        track(await Location.watchHeadingAsync((h) => (latest.current.compass = h)));
      }

      if (cancelled) return;

      if (await DeviceMotion.isAvailableAsync()) {
        const motionPerm = await DeviceMotion.requestPermissionsAsync().catch(() => null);
        if (cancelled) return;

        if (motionPerm?.granted !== false) {
          DeviceMotion.setUpdateInterval(SENSOR_INTERVAL_MS);
          track(DeviceMotion.addListener((m) => (latest.current.motion = m)));
        }
      }

      if (cancelled) return;

      if (await Magnetometer.isAvailableAsync()) {
        Magnetometer.setUpdateInterval(SENSOR_INTERVAL_MS);
        track(Magnetometer.addListener((m) => (latest.current.magnetometer = m)));
      }
    })().catch(() => {
      // a failed sensor shouldn't masquerade as a denied location permission
    });

    return () => {
      cancelled = true;
      subs.forEach((s) => s.remove());
    };
  }, []);

  /** Copy of the latest readings, safe to serialize. */
  const snapshot = useCallback((): Telemetry => JSON.parse(JSON.stringify(latest.current)), []);

  return { position, permission, snapshot };
}