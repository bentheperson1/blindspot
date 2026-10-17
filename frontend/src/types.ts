export type LatLng = { latitude: number; longitude: number };

/** A camera as returned by the backend. The backend computes distance and alert. */
export type Camera = {
  id: string;
  latitude: number;
  longitude: number;
  distance_m?: number;
  alert?: boolean;
  name?: string;
  /** Optional field-of-view polygon to draw on the map. */
  cone?: LatLng[];
};

export type TravelMode = 'pedestrian' | 'driver';
export type Units = 'imperial' | 'metric';
export type ViewMode = 'map' | 'ar';

/** One object the model found in a frame. Box is normalized 0–1: [x, y, w, h]. */
export type Detection = {
  label: string;
  confidence: number;
  box: [number, number, number, number];
};

export type BackendStatus = 'off' | 'connecting' | 'ok' | 'error';
