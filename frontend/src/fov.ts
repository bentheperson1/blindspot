/**
 * Horizontal field of view of the camera view as it appears on screen, for /cameras/nearby (`hfov`).
 *
 * The backend's project_to_screen needs this number to place cameras at the right pixel.
 * It comes from the lens's 35mm-equivalent focal length (read live from each frame's EXIF),
 * adjusted for how the preview fills the screen (it's cropped on the sides to fill a tall phone screen).
 *
 * Phone sensors are 4:3. In 35mm-equivalent terms (43.27 mm diagonal) that's 34.62 × 25.96 mm.
 * The app is portrait-only, so the sensor's long side runs up the screen.
 */
const SENSOR_LONG_MM = 34.62;
const SENSOR_SHORT_MM = 25.96;
/** Typical main phone camera (≈26 mm equivalent), used until the first frame's EXIF arrives. */
export const DEFAULT_FOCAL_35MM = 26;

const deg = (rad: number) => (rad * 180) / Math.PI;

export function screenHfov(focal35mm: number | null | undefined, screenW: number, screenH: number): number {
  const f = focal35mm && focal35mm > 0 ? focal35mm : DEFAULT_FOCAL_35MM;
  const sensorAspect = SENSOR_SHORT_MM / SENSOR_LONG_MM; // width / height in portrait (0.75)
  const screenAspect = screenW / screenH;
  if (screenAspect < sensorAspect) {
    // Preview fills the height and is cropped left/right (normal for phones).
    const halfV = Math.atan(SENSOR_LONG_MM / (2 * f));
    return deg(2 * Math.atan(Math.tan(halfV) * screenAspect));
  }
  // Wider screen (tablet): preview fills the width.
  return deg(2 * Math.atan(SENSOR_SHORT_MM / (2 * f)));
}
