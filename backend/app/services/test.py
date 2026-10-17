import math

import cv2
import numpy as np

screen_w = 1080
screen_h = 1920
preview_scale = 0.4
preview_w = int(screen_w * preview_scale)
preview_h = int(screen_h * preview_scale)

map_w = 432
map_h = preview_h

meters_per_deg_lat = 111320.0
move_speed = 2.0
turn_speed = 3.0

color_visible = (80, 220, 80)
color_edge = (60, 160, 255)
color_text = (230, 230, 230)


def make_state():
    return {
        "lat": 32.9857,
        "lon": -96.7502,
        "alt": 1.5,
        "yaw": 0.0,
        "pitch": 0.0,
        "roll": 0.0,
        "hfov": 60.0,
        "map_ppm": 4.0,
        "targets": [
            {"name": "T1", "lat": 32.9860, "lon": -96.7505, "alt": 1.5},
            {"name": "T2", "lat": 32.9862, "lon": -96.7498, "alt": 1.5},
            {"name": "T3", "lat": 32.9852, "lon": -96.7502, "alt": 1.5},
        ],
        "target_counter": 3,
    }


def geodetic_to_ecef(lat, lon, alt=0):
    a = 6378137.0
    e2 = 0.00669437999014

    lat_rad = np.radians(lat)
    lon_rad = np.radians(lon)

    n = a / np.sqrt(1.0 - e2 * np.sin(lat_rad) ** 2)

    x = (n + alt) * np.cos(lat_rad) * np.cos(lon_rad)
    y = (n + alt) * np.cos(lat_rad) * np.sin(lon_rad)
    z = (n * (1.0 - e2) + alt) * np.sin(lat_rad)

    return np.array([x, y, z])


def ecef_to_enu(ecef_target, ecef_phone, lat_phone, lon_phone):
    lat_rad = np.radians(lat_phone)
    lon_rad = np.radians(lon_phone)

    delta = ecef_target - ecef_phone

    rot = np.array([
        [-np.sin(lon_rad), np.cos(lon_rad), 0],
        [-np.sin(lat_rad) * np.cos(lon_rad), -np.sin(lat_rad) * np.sin(lon_rad), np.cos(lat_rad)],
        [np.cos(lat_rad) * np.cos(lon_rad), np.cos(lat_rad) * np.sin(lon_rad), np.sin(lat_rad)]
    ])

    return rot.dot(delta)


def get_camera_axes(yaw, pitch, roll):
    # yaw: compass heading (0 = north, clockwise)
    # pitch: positive looks up
    # roll: positive tilts the phone clockwise
    y = math.radians(yaw)
    p = math.radians(pitch)
    r = math.radians(roll)

    forward = np.array([math.sin(y) * math.cos(p), math.cos(y) * math.cos(p), math.sin(p)])
    right_base = np.array([math.cos(y), -math.sin(y), 0.0])
    up_base = np.cross(right_base, forward)

    right = right_base * math.cos(r) - up_base * math.sin(r)
    up = right_base * math.sin(r) + up_base * math.cos(r)

    return right, up, forward


def world_to_camera(enu, right, up, forward):
    xc = float(np.dot(enu, right))
    yc = -float(np.dot(enu, up))
    zc = float(np.dot(enu, forward))

    return xc, yc, zc


def camera_to_screen(xc, yc, zc, hfov):
    fx = (screen_w / 2.0) / math.tan(math.radians(hfov) / 2.0)
    fy = fx
    cx = screen_w / 2.0
    cy = screen_h / 2.0

    xs = xc * fx / zc + cx
    ys = yc * fy / zc + cy

    return xs, ys


def project_target(state, target, axes):
    ecef_phone = geodetic_to_ecef(state["lat"], state["lon"], state["alt"])
    ecef_target = geodetic_to_ecef(target["lat"], target["lon"], target["alt"])

    enu = ecef_to_enu(ecef_target, ecef_phone, state["lat"], state["lon"])
    dist = float(np.linalg.norm(enu))

    right, up, forward = axes
    xc, yc, zc = world_to_camera(enu, right, up, forward)

    if zc <= 0:
        return {"status": "behind", "dist": dist, "enu": enu}

    xs, ys = camera_to_screen(xc, yc, zc, state["hfov"])
    visible = 0 <= xs <= screen_w and 0 <= ys <= screen_h

    return {"status": "visible" if visible else "off", "xs": xs, "ys": ys, "dist": dist, "enu": enu}


def offset_to_latlon(lat, lon, east, north):
    new_lat = lat + north / meters_per_deg_lat
    new_lon = lon + east / (meters_per_deg_lat * math.cos(math.radians(lat)))

    return new_lat, new_lon


def draw_phone_view(state):
    view = np.full((preview_h, preview_w, 3), 30, dtype=np.uint8)
    axes = get_camera_axes(state["yaw"], state["pitch"], state["roll"])
    right, up, forward = axes

    # horizon line
    horizon_points = []

    for offset in range(-80, 81, 10):
        heading = math.radians(state["yaw"] + offset)
        direction = np.array([math.sin(heading), math.cos(heading), 0.0])
        xc, yc, zc = world_to_camera(direction, right, up, forward)

        if zc > 0.01:
            xs, ys = camera_to_screen(xc, yc, zc, state["hfov"])
            horizon_points.append((int(xs * preview_scale), int(ys * preview_scale)))
        else:
            horizon_points.append(None)

    for a, b in zip(horizon_points, horizon_points[1:]):
        if a is not None and b is not None:
            cv2.line(view, a, b, (90, 90, 90), 1, cv2.LINE_AA)

    # crosshair
    mid_x = preview_w // 2
    mid_y = preview_h // 2
    cv2.line(view, (mid_x - 10, mid_y), (mid_x + 10, mid_y), (70, 70, 70), 1)
    cv2.line(view, (mid_x, mid_y - 10), (mid_x, mid_y + 10), (70, 70, 70), 1)

    # targets
    for target in state["targets"]:
        result = project_target(state, target, axes)

        if result["status"] == "behind":
            continue

        px = int(result["xs"] * preview_scale)
        py = int(result["ys"] * preview_scale)
        label = f"{target['name']} {result['dist']:.0f}m"

        if result["status"] == "visible":
            cv2.circle(view, (px, py), 9, color_visible, 2, cv2.LINE_AA)
            cv2.circle(view, (px, py), 2, color_visible, -1, cv2.LINE_AA)
            cv2.putText(view, label, (px + 14, py + 5), cv2.FONT_HERSHEY_SIMPLEX, 0.45, color_visible, 1, cv2.LINE_AA)
        else:
            ex = int(np.clip(px, 10, preview_w - 10))
            ey = int(np.clip(py, 10, preview_h - 10))
            cv2.circle(view, (ex, ey), 7, color_edge, 2, cv2.LINE_AA)

            text_x = int(np.clip(ex - 30, 4, preview_w - 90))
            text_y = int(np.clip(ey + 20, 14, preview_h - 4))
            cv2.putText(view, label, (text_x, text_y), cv2.FONT_HERSHEY_SIMPLEX, 0.4, color_edge, 1, cv2.LINE_AA)

    # hud
    hud_lines = [
        f"lat {state['lat']:.6f}  lon {state['lon']:.6f}",
        f"yaw {state['yaw']:.0f}  pitch {state['pitch']:.0f}  roll {state['roll']:.0f}",
        f"hfov {state['hfov']:.0f}",
    ]

    for i, line in enumerate(hud_lines):
        cv2.putText(view, line, (8, 18 + i * 18), cv2.FONT_HERSHEY_SIMPLEX, 0.45, color_text, 1, cv2.LINE_AA)

    cv2.rectangle(view, (0, 0), (preview_w - 1, preview_h - 1), (120, 120, 120), 1)

    return view


def draw_map_view(state):
    view = np.full((map_h, map_w, 3), 22, dtype=np.uint8)

    ppm = state["map_ppm"]
    cx = map_w // 2
    cy = map_h // 2

    # range rings
    for radius_m in [10, 25, 50, 100]:
        radius_px = int(radius_m * ppm)

        cv2.circle(view, (cx, cy), radius_px, (55, 55, 55), 1, cv2.LINE_AA)
        cv2.putText(view, f"{radius_m}m", (cx + radius_px + 2, cy - 2), cv2.FONT_HERSHEY_SIMPLEX, 0.35, (90, 90, 90), 1, cv2.LINE_AA)

    cv2.putText(view, "N", (cx - 5, 16), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (160, 160, 160), 1, cv2.LINE_AA)

    # fov cone
    half_fov = state["hfov"] / 2.0
    cone_len = 600

    for angle in [state["yaw"] - half_fov, state["yaw"] + half_fov]:
        a = math.radians(angle)
        end = (int(cx + math.sin(a) * cone_len), int(cy - math.cos(a) * cone_len))
        cv2.line(view, (cx, cy), end, (140, 120, 60), 1, cv2.LINE_AA)

    a = math.radians(state["yaw"])
    heading_end = (int(cx + math.sin(a) * 30), int(cy - math.cos(a) * 30))
    cv2.arrowedLine(view, (cx, cy), heading_end, (255, 200, 80), 2, cv2.LINE_AA)

    # phone
    cv2.circle(view, (cx, cy), 5, (255, 255, 255), -1, cv2.LINE_AA)

    # targets
    axes = get_camera_axes(state["yaw"], state["pitch"], state["roll"])

    for target in state["targets"]:
        result = project_target(state, target, axes)
        enu = result["enu"]

        tx = int(cx + enu[0] * ppm)
        ty = int(cy - enu[1] * ppm)

        color = color_visible if result["status"] == "visible" else color_edge

        if result["status"] == "behind":
            color = (110, 110, 110)

        cv2.circle(view, (tx, ty), 5, color, -1, cv2.LINE_AA)
        cv2.putText(view, target["name"], (tx + 8, ty + 4), cv2.FONT_HERSHEY_SIMPLEX, 0.45, color, 1, cv2.LINE_AA)

    help_lines = [
        "WASD move   J/L yaw   I/K pitch   U/O roll",
        "Z/X fov   [ ] map zoom   R reset   C clear",
        "click map: add target   ESC quit",
    ]

    for i, line in enumerate(help_lines):
        cv2.putText(view, line, (8, map_h - 50 + i * 16), cv2.FONT_HERSHEY_SIMPLEX, 0.38, (150, 150, 150), 1, cv2.LINE_AA)

    cv2.rectangle(view, (0, 0), (map_w - 1, map_h - 1), (120, 120, 120), 1)

    return view


def handle_key(state, key):
    forward_step = 0.0
    right_step = 0.0

    if key == "w":
        forward_step = move_speed
    elif key == "s":
        forward_step = -move_speed
    elif key == "a":
        right_step = -move_speed
    elif key == "d":
        right_step = move_speed

    if forward_step != 0.0 or right_step != 0.0:
        heading = math.radians(state["yaw"])

        east = forward_step * math.sin(heading) + right_step * math.cos(heading)
        north = forward_step * math.cos(heading) - right_step * math.sin(heading)

        state["lat"], state["lon"] = offset_to_latlon(state["lat"], state["lon"], east, north)

    if key == "j":
        state["yaw"] = (state["yaw"] - turn_speed) % 360
    elif key == "l":
        state["yaw"] = (state["yaw"] + turn_speed) % 360
    elif key == "i":
        state["pitch"] = min(89.0, state["pitch"] + turn_speed)
    elif key == "k":
        state["pitch"] = max(-89.0, state["pitch"] - turn_speed)
    elif key == "u":
        state["roll"] -= turn_speed
    elif key == "o":
        state["roll"] += turn_speed
    elif key == "z":
        state["hfov"] = max(20.0, state["hfov"] - 2)
    elif key == "x":
        state["hfov"] = min(120.0, state["hfov"] + 2)
    elif key == "[":
        state["map_ppm"] = max(0.5, state["map_ppm"] / 1.25)
    elif key == "]":
        state["map_ppm"] = min(40.0, state["map_ppm"] * 1.25)
    elif key == "c":
        state["targets"].clear()
    elif key == "r":
        state.update(make_state())


def on_mouse(event, x, y, flags, state):
    if event != cv2.EVENT_LBUTTONDOWN:
        return

    if x < preview_w:
        return

    map_x = x - preview_w

    east = (map_x - map_w / 2.0) / state["map_ppm"]
    north = -(y - map_h / 2.0) / state["map_ppm"]

    # click is relative to the phone, so rotate-free ENU offset (map is north-up)
    lat, lon = offset_to_latlon(state["lat"], state["lon"], east, north)

    state["target_counter"] += 1
    state["targets"].append({
        "name": f"T{state['target_counter']}",
        "lat": lat,
        "lon": lon,
        "alt": state["alt"],
    })


def main():
    state = make_state()
    window_name = "AR projection test"

    cv2.namedWindow(window_name)
    cv2.setMouseCallback(window_name, on_mouse, state)

    while True:
        phone_view = draw_phone_view(state)
        map_view = draw_map_view(state)

        cv2.imshow(window_name, np.hstack([phone_view, map_view]))

        raw_key = cv2.waitKey(16) & 0xFF

        if raw_key == 27:
            break

        if raw_key != 255:
            handle_key(state, chr(raw_key).lower())

    cv2.destroyAllWindows()


if __name__ == "__main__":
    main()