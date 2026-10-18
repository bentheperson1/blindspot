import base64
import binascii

import cv2
import numpy as np

import math

from app.schemas.vision import Base64ImageRequest, Base64ImageResponse, ImageInfo, UserMessage, ImageInfo, Telemetry, UserMessage

from .ar_projection import *

def to_360(angle):
	if angle is None:
		return 0.0

	return math.degrees(angle) % 360

class InvalidImageError(Exception):
	pass


def decode_base64(data: str) -> bytes:
	# Accept both raw base64 and data URLs ("data:image/png;base64,....")
	if data.startswith("data:") and "," in data:
		data = data.split(",", 1)[1]

	try:
		return base64.b64decode(data, validate=True)
	except (binascii.Error, ValueError):
		raise InvalidImageError("Invalid base64 data")


def decode_image(data: bytes) -> np.ndarray:
	if not data:
		raise InvalidImageError("Empty image data")

	buffer = np.frombuffer(data, dtype=np.uint8)
	image = cv2.imdecode(buffer, cv2.IMREAD_COLOR)

	if image is None:
		raise InvalidImageError("Could not decode image data")

	return image


def encode_image(image: np.ndarray, ext: str = ".jpg", quality: int = 90) -> bytes:
	params = []

	if ext in (".jpg", ".jpeg"):
		params = [cv2.IMWRITE_JPEG_QUALITY, quality]

	success, encoded = cv2.imencode(ext, image, params)

	if not success:
		raise InvalidImageError("Could not encode image")

	return encoded.tobytes()



def process_sent_data(camera_width: int, camera_height: int, telemetry: Telemetry) -> tuple[int, int] | None:
    w = camera_width
    h = camera_height

    if telemetry.location is None:
        print("No location in telemetry.")
        return [-1, -1]

    coord_lat = telemetry.location.latitude
    coord_long = telemetry.location.longitude

    target_lat = 32.9829167
    target_long = -96.7566389

    rotation = telemetry.motion.rotation if telemetry.motion and telemetry.motion.rotation else None

    if rotation is None:
        print("No rotation in telemetry.")
        return [-1, -1]

    alpha = to_360(rotation.alpha)
    beta = to_360(rotation.beta)
    gamma = to_360(rotation.gamma)
    compass_heading = telemetry.compass.trueHeading
	
    print(f"Alpha(yaw): {alpha:.1f}, Beta(pitch): {beta:.1f}, Gamma(roll): {gamma:.1f}")
    print(f"Coord: {coord_lat}, {coord_long}")
    print(f"Target: {target_lat}, {target_long}")
    print(f"Camera heading: {camera_heading(alpha, beta, gamma):.1f}")

    # Argument order is (alpha, beta, gamma) = (yaw, pitch, roll)
    result = project_to_screen(
        coord_lat, coord_long,
        alpha, beta, gamma,
        target_lat, target_long,
        screen_w=w, screen_h=h,
        compass_heading=compass_heading,
        hfov=53
    )

    if result[0] is None:
        print("Target is behind the camera plane.")
        return [-1, -1]

    x, y = int(round(result[0])), int(round(result[1]))

    if not (0 <= x < w and 0 <= y < h):
        print(f"Target is off-screen at ({x}, {y}).")
        return [-1, -1]

    # cv2.circle(image, (x, y), 10, (0, 0, 255), -1)

    x_normalized = x / w
    y_normalized = y / h
    
    return [x_normalized, y_normalized]
