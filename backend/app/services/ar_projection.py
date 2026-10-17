import math
import numpy as np

def geodetic_to_ecef(lat, lon, alt=0):
    a = 6378137.0
    e2 = 0.00669437999014
    
    lat_rad = np.radians(lat)
    lon_rad = np.radians(lon)
    
    N = a / np.sqrt(1.0 - e2 * np.sin(lat_rad)**2)
    
    X = (N + alt) * np.cos(lat_rad) * np.cos(lon_rad)
    Y = (N + alt) * np.cos(lat_rad) * np.sin(lon_rad)
    Z = (N * (1.0 - e2) + alt) * np.sin(lat_rad)
    
    return np.array([X, Y, Z])

def ecef_to_enu(ecef_target, ecef_phone, lat_phone, lon_phone):
    lat_rad = np.radians(lat_phone)
    lon_rad = np.radians(lon_phone)
    
    delta = ecef_target - ecef_phone
    
    R = np.array([
        [-np.sin(lon_rad), np.cos(lon_rad), 0],
        [-np.sin(lat_rad)*np.cos(lon_rad), -np.sin(lat_rad)*np.sin(lon_rad), np.cos(lat_rad)],
        [np.cos(lat_rad)*np.cos(lon_rad), np.cos(lat_rad)*np.sin(lon_rad), np.sin(lat_rad)]
    ])
    
    return R.dot(delta)

def get_rotation_matrix(yaw, pitch, roll):
    y = np.radians(yaw)
    p = np.radians(pitch)
    r = np.radians(roll)
    
    R_yaw = np.array([
        [np.cos(y), -np.sin(y), 0],
        [np.sin(y), np.cos(y), 0],
        [0, 0, 1]
    ])
    
    R_pitch = np.array([
        [1, 0, 0],
        [0, np.cos(p), -np.sin(p)],
        [0, np.sin(p), np.cos(p)]
    ])
    
    R_roll = np.array([
        [np.cos(r), 0, np.sin(r)],
        [0, 1, 0],
        [-np.sin(r), 0, np.cos(r)]
    ])
    
    return R_roll.dot(R_pitch).dot(R_yaw)

def project_to_screen(lat_p, lon_p, yaw, pitch, roll, lat_t, lon_t, screen_w=1080, screen_h=1920, hfov=60):
    ecef_phone = geodetic_to_ecef(lat_p, lon_p)
    ecef_target = geodetic_to_ecef(lat_t, lon_t)
    
    enu_coords = ecef_to_enu(ecef_target, ecef_phone, lat_p, lon_p)
    
    R_camera = get_rotation_matrix(yaw, pitch, roll)
    camera_coords = R_camera.dot(enu_coords)
    
    xc, yc, zc = camera_coords
    
    if zc <= 0:
        return None, "Target is behind the camera plane."
    
    fx = (screen_w / 2.0) / np.tan(np.radians(hfov) / 2.0)
    fy = fx 
    cx, cy = screen_w / 2.0, screen_h / 2.0
    
    xs = (xc * fx / zc) + cx
    ys = (yc * fy / zc) + cy
    
    if 0 <= xs <= screen_w and 0 <= ys <= screen_h:
        return (round(xs, 2), round(ys, 2)), "Visible"
    else:
        return (round(xs, 2), round(ys, 2)), "Off-screen (But in front of camera view)"