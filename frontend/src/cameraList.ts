import { useEffect, useMemo, useRef, useState } from 'react';
import { NoListEndpoint, fetchCameraList } from './api';
import { CAMERA_LIST_MOVE_FRACTION, CAMERA_LIST_REFRESH_MS } from './config';
import type { CachedCamera } from './projection';
import type { BackendStatus, Camera, LatLng, TravelMode } from './types';

/** Meters along the ground between two GPS points (haversine). */
export function metersBetween(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * r) / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(a));
}

/**
 * Map tab: the same /cameras/list cache the Camera tab uses. Re-downloads every 30 s walking / 5 s driving,
 * or sooner if you move a quarter of the radius or change the radius. Distances are worked out on the phone
 * from your live GPS on every update, so they move with you without extra network calls.
 */
export function useMapCameras(enabled: boolean, apiUrl: string, position: LatLng | null, radius_m: number, mode: TravelMode) {
  const [list, setList] = useState<{ cams: CachedCamera[]; at: number; lat: number; lon: number; radius: number } | null>(null);
  const [status, setStatus] = useState<BackendStatus>('off');
  const [error, setError] = useState<string | null>(null);
  const posRef = useRef(position);
  posRef.current = position;
  const optsRef = useRef({ radius_m, mode });
  optsRef.current = { radius_m, mode };
  const listRef = useRef(list);
  listRef.current = list;

  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    setStatus((s) => (s === 'ok' ? s : 'connecting'));
    (async () => {
      while (!stopped) {
        let wait = 1000; // check once a second whether a re-download is due
        const pos = posRef.current;
        const { radius_m: r, mode: m } = optsRef.current;
        const cached = listRef.current;
        if (pos) {
          const due =
            !cached ||
            cached.radius !== r ||
            Date.now() - cached.at > CAMERA_LIST_REFRESH_MS[m] ||
            metersBetween(cached.lat, cached.lon, pos.latitude, pos.longitude) > r * CAMERA_LIST_MOVE_FRACTION;
          if (due) {
            try {
              const cams = await fetchCameraList(apiUrl, pos.latitude, pos.longitude, r);
              if (stopped) break;
              setList({ cams, at: Date.now(), lat: pos.latitude, lon: pos.longitude, radius: r });
              setStatus('ok');
              setError(null);
            } catch (e) {
              if (stopped) break;
              setStatus('error');
              setError(e instanceof NoListEndpoint ? 'The backend has no /cameras/list yet. Restart it with the latest code.' : String(e));
              wait = 10_000;
            }
          }
        }
        await new Promise((res) => setTimeout(res, wait));
      }
    })();
    return () => {
      stopped = true;
    };
  }, [enabled, apiUrl]);

  // Nearest first, only those inside the radius, with distance from where you are right now.
  const cameras: Camera[] = useMemo(() => {
    if (!list) return [];
    const here = position ?? { latitude: list.lat, longitude: list.lon };
    return list.cams
      .map((c, i) => ({
        id: `${c.name}-${i}`,
        name: c.name,
        latitude: c.latitude,
        longitude: c.longitude,
        heading: c.heading,
        distance_m: metersBetween(here.latitude, here.longitude, c.latitude, c.longitude),
      }))
      .filter((c) => c.distance_m <= radius_m)
      .sort((a, b) => a.distance_m - b.distance_m);
  }, [list, position?.latitude, position?.longitude, radius_m]);

  return { cameras, status, error };
}