import math
import numpy as np
from typing import List
from ..schemas.vision import FlockCamera

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

def get_rotation_matrix(alpha, beta, gamma):
    a, b, g = np.radians([alpha, beta, gamma])
    Rz = np.array([[np.cos(a), -np.sin(a), 0],
                   [np.sin(a),  np.cos(a), 0],
                   [0, 0, 1]])
    Rx = np.array([[1, 0, 0],
                   [0, np.cos(b), -np.sin(b)],
                   [0, np.sin(b),  np.cos(b)]])
    Ry = np.array([[ np.cos(g), 0, np.sin(g)],
                   [0, 1, 0],
                   [-np.sin(g), 0, np.cos(g)]])
    return Rz @ Rx @ Ry

def yaw_corrected_matrix(alpha, beta, gamma, heading_deg):
    R = get_rotation_matrix(alpha, beta, gamma)
    fwd = R @ np.array([0.0, 0.0, -1.0])
    h_motion = np.degrees(np.arctan2(fwd[0], fwd[1]))
    d = np.radians(h_motion - heading_deg)
    c, s = np.cos(d), np.sin(d)
    Rz = np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]])
    return Rz @ R

def camera_heading(alpha, beta, gamma):
    """Compass heading (deg) the rear camera is pointing at. Debug helper."""
    fwd = get_rotation_matrix(alpha, beta, gamma) @ np.array([0.0, 0.0, -1.0])
    return np.degrees(np.arctan2(fwd[0], fwd[1])) % 360

def yaw_corrected_matrix(alpha, beta, gamma, heading_deg):
    R = get_rotation_matrix(alpha, beta, gamma)
    fwd = R @ np.array([0.0, 0.0, -1.0])
    h_motion = np.degrees(np.arctan2(fwd[0], fwd[1]))
    d = np.radians(h_motion - heading_deg)
    c, s = np.cos(d), np.sin(d)
    Rz = np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]])
    return Rz @ R

def project_to_screen(lat_p, lon_p, alpha, beta, gamma, compass_heading, flockCoordinates: List[FlockCamera], screen_w=1080, screen_h=1920, hfov=53):
    results = []

    for camera in flockCoordinates:
        enu = ecef_to_enu(geodetic_to_ecef(camera.latitude, camera.longitude), geodetic_to_ecef(lat_p, lon_p), lat_p, lon_p)

        dev = yaw_corrected_matrix(alpha, beta, gamma, compass_heading).T @ enu

        xc, yc, zc = dev[0], -dev[1], -dev[2]

        if zc <= 0:
            return [None, None]

        fx = (screen_w / 2.0) / np.tan(np.radians(hfov) / 2.0)
        xs = xc * fx / zc + screen_w / 2.0
        ys = yc * fx / zc + screen_h / 2.0

        normalized_x = xs / screen_w
        normalized_y = ys / screen_h
        
        results.append(
            {
                "name": camera.name, 
                "x": normalized_x, 
                "y": normalized_y, 
                "distance_to_user": zc
            }
        )
        
        """
        if 0 <= xs <= screen_w and 0 <= ys <= screen_h:
            return (round(xs, 2), round(ys, 2)), "Visible"
        else:
            return (round(xs, 2), round(ys, 2)), "Off-screen (But in front of camera view)"
        """
    
    return results
