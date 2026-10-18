import base64
import binascii
import hashlib

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
	import cv2  # lazy: OpenCV isn't installed on the s390x server

	if not data:
		raise InvalidImageError("Empty image data")

	buffer = np.frombuffer(data, dtype=np.uint8)
	image = cv2.imdecode(buffer, cv2.IMREAD_COLOR)

	if image is None:
		raise InvalidImageError("Could not decode image data")

	return image


def encode_image(image: np.ndarray, ext: str = ".jpg", quality: int = 90) -> bytes:
	import cv2  # lazy: OpenCV isn't installed on the s390x server

	params = []

	if ext in (".jpg", ".jpeg"):
		params = [cv2.IMWRITE_JPEG_QUALITY, quality]

	success, encoded = cv2.imencode(ext, image, params)

	if not success:
		raise InvalidImageError("Could not encode image")

	return encoded.tobytes()



# INSERT ACTUAL MODEL HERE
_FLOCK_TYPES = [
    "Flock Safety Falcon",
    "Flock Safety Falcon Flex",
    "Flock Safety Raven",
]
_OTHER_TYPES = [
    "Traffic camera",
    "Security camera",
    "Not a camera",
    "Unknown device",
]

def classify_camera(image: np.ndarray, lat: float | None, lon: float | None) -> dict:
    digest = int(hashlib.sha1(image.tobytes()).hexdigest(), 16)
    is_flock = (digest % 2) == 0
    confidence = round(0.6 + (digest % 40) / 100.0, 2)  # 0.60–0.99
    if is_flock:
        camera_type = _FLOCK_TYPES[digest % len(_FLOCK_TYPES)]
        message = "Looks like a Flock automated license-plate reader."
    else:
        camera_type = _OTHER_TYPES[digest % len(_OTHER_TYPES)]
        message = "This doesn't match a Flock camera."
    return {
        "is_flock": is_flock,
        "camera_type": camera_type,
        "confidence": confidence,
        "message": message,
    }


def process_sent_data(flock_cameras: list[FlockCamera], source_width: int, source_height: int, telemetry: Telemetry) -> list | None:
    w = source_width
    h = source_height

    if telemetry.location is None:
        print("No location in telemetry.")
        return []

    coord_lat = telemetry.location.latitude
    coord_long = telemetry.location.longitude

    rotation = telemetry.motion.rotation if telemetry.motion and telemetry.motion.rotation else None

    if rotation is None:
        print("No rotation in telemetry.")
        return []

    alpha = to_360(rotation.alpha)
    beta = to_360(rotation.beta)
    gamma = to_360(rotation.gamma)
    telem_heading = telemetry.compass.trueHeading
	
    print(f"Alpha(yaw): {alpha:.1f}, Beta(pitch): {beta:.1f}, Gamma(roll): {gamma:.1f}")
    print(f"Coord: {coord_lat}, {coord_long}")

    # Argument order is (alpha, beta, gamma) = (yaw, pitch, roll)
    result = project_to_screen(
        coord_lat, coord_long,
        alpha, beta, gamma,
        telem_heading,
        flock_cameras,
        w, h,
        hfov=53
    )

    return result
