/**
 * On-phone copy of the backend's project_to_screen (backend/app/services/ar_projection.py).
 * Same math, line for line, so markers land exactly where /cameras/nearby would put them —
 * but it runs locally ~10×/s on the cached camera list instead of one network call per update.
 *
 * Inputs match the /cameras/nearby body: angles in degrees, screen size in points, hfov in degrees.
 * Output x/y are 0–1 fractions of the screen (same as the backend); cameras behind you are skipped.
 */

export type CachedCamera = { name: string; latitude: number; longitude: number; heading?: number };
export type ProjectedCamera = { name: string; x: number; y: number; distance_to_user: number; index: number };

type Vec3 = [number, number, number];
type Mat3 = [Vec3, Vec3, Vec3];

const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

function matMul(a: Mat3, b: Mat3): Mat3 {
  const r = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ] as Mat3;
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) r[i][j] = a[i][0] * b[0][j] + a[i][1] * b[1][j] + a[i][2] * b[2][j];
  return r;
}
const matVec = (m: Mat3, v: Vec3): Vec3 => [
  m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
  m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
  m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
];
const transpose = (m: Mat3): Mat3 => [
  [m[0][0], m[1][0], m[2][0]],
  [m[0][1], m[1][1], m[2][1]],
  [m[0][2], m[1][2], m[2][2]],
];

// geodetic_to_ecef
function geodeticToEcef(lat: number, lon: number, alt = 0): Vec3 {
  const a = 6378137.0;
  const e2 = 0.00669437999014;
  const la = rad(lat);
  const lo = rad(lon);
  const N = a / Math.sqrt(1.0 - e2 * Math.sin(la) ** 2);
  return [(N + alt) * Math.cos(la) * Math.cos(lo), (N + alt) * Math.cos(la) * Math.sin(lo), (N * (1.0 - e2) + alt) * Math.sin(la)];
}

// ecef_to_enu
function ecefToEnu(target: Vec3, phone: Vec3, latPhone: number, lonPhone: number): Vec3 {
  const la = rad(latPhone);
  const lo = rad(lonPhone);
  const d: Vec3 = [target[0] - phone[0], target[1] - phone[1], target[2] - phone[2]];
  const R: Mat3 = [
    [-Math.sin(lo), Math.cos(lo), 0],
    [-Math.sin(la) * Math.cos(lo), -Math.sin(la) * Math.sin(lo), Math.cos(la)],
    [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)],
  ];
  return matVec(R, d);
}

// get_rotation_matrix
function rotationMatrix(alpha: number, beta: number, gamma: number): Mat3 {
  const a = rad(alpha);
  const b = rad(beta);
  const g = rad(gamma);
  const Rz: Mat3 = [
    [Math.cos(a), -Math.sin(a), 0],
    [Math.sin(a), Math.cos(a), 0],
    [0, 0, 1],
  ];
  const Rx: Mat3 = [
    [1, 0, 0],
    [0, Math.cos(b), -Math.sin(b)],
    [0, Math.sin(b), Math.cos(b)],
  ];
  const Ry: Mat3 = [
    [Math.cos(g), 0, Math.sin(g)],
    [0, 1, 0],
    [-Math.sin(g), 0, Math.cos(g)],
  ];
  return matMul(matMul(Rz, Rx), Ry);
}

/**
 * How far the gyro's yaw (DeviceMotion alpha) is from true north, in degrees: the `d` inside the backend's
 * yaw_corrected_matrix. It should barely change over time, so the app smooths it instead of trusting each
 * jittery compass reading (see projectToScreen's `yawOffsetDeg`).
 */
export function yawOffsetDeg(alpha: number, beta: number, gamma: number, headingDeg: number): number {
  const fwd = matVec(rotationMatrix(alpha, beta, gamma), [0, 0, -1]);
  return deg(Math.atan2(fwd[0], fwd[1])) - headingDeg;
}

// yaw_corrected_matrix (with an optional pre-smoothed offset)
function yawCorrectedMatrix(alpha: number, beta: number, gamma: number, headingDeg: number, offsetDeg?: number): Mat3 {
  const R = rotationMatrix(alpha, beta, gamma);
  const d = rad(offsetDeg ?? yawOffsetDeg(alpha, beta, gamma, headingDeg));
  const c = Math.cos(d);
  const s = Math.sin(d);
  const Rz: Mat3 = [
    [c, -s, 0],
    [s, c, 0],
    [0, 0, 1],
  ];
  return matMul(Rz, R);
}

// project_to_screen
export function projectToScreen(
  latP: number,
  lonP: number,
  alpha: number,
  beta: number,
  gamma: number,
  compassHeading: number,
  cameras: CachedCamera[],
  screenW = 1080,
  screenH = 1920,
  hfov = 53,
  /**
   * Optional accuracy extras (not in the backend version):
   *   yawOffsetDeg  smoothed gyro-to-north offset (from yawOffsetDeg) instead of this instant's compass reading
   *   phoneAltM     height of the phone above the ground, meters
   *   cameraAltM    height of the Flock camera on its pole, meters
   */
  opts: { yawOffsetDeg?: number; phoneAltM?: number; cameraAltM?: number } = {},
): ProjectedCamera[] {
  const out: ProjectedCamera[] = [];
  const phone = geodeticToEcef(latP, lonP, opts.phoneAltM ?? 0);
  const Mt = transpose(yawCorrectedMatrix(alpha, beta, gamma, compassHeading, opts.yawOffsetDeg)); // same for every camera
  const fx = screenW / 2.0 / Math.tan(rad(hfov) / 2.0);
  cameras.forEach((cam, index) => {
    const enu = ecefToEnu(geodeticToEcef(cam.latitude, cam.longitude, opts.cameraAltM ?? 0), phone, latP, lonP);
    const dev = matVec(Mt, enu);
    const xc = dev[0];
    const yc = -dev[1];
    const zc = -dev[2];
    if (zc <= 0) return; // behind the camera
    const xs = (xc * fx) / zc + screenW / 2.0;
    const ys = (yc * fx) / zc + screenH / 2.0;
    out.push({ name: cam.name, x: xs / screenW, y: ys / screenH, distance_to_user: zc, index });
  });
  return out;
}